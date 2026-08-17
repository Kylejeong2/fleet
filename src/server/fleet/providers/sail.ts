import { z } from 'zod'
import { HttpUrlSchema } from '../../../lib/fleet-protocol'
import { fleetLog } from '../log'
import type { WorkerModel, WorkerResponse, WorkerTurn } from '../ports'

const ResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'cancelled']),
  output: z.array(z.unknown()).default([]),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }).optional(),
})

const FunctionCallSchema = z.object({
  type: z.literal('function_call'),
  name: z.enum(['search', 'fetch']),
  arguments: z.string(),
})

const MessageSchema = z.object({
  type: z.literal('message'),
  content: z.array(
    z.object({ type: z.literal('output_text'), text: z.string() }).passthrough(),
  ),
})

const ReasoningSchema = z.object({
  type: z.literal('reasoning'),
  summary: z.array(z.object({ text: z.string() }).passthrough()).default([]),
  content: z.array(z.object({ text: z.string() }).passthrough()).default([]),
}).passthrough()

const ToolReasoningSchema = z.string().trim().min(1).max(500)
const SearchArgumentsSchema = z.object({
  query: z.string().min(1).max(200),
  reasoning: ToolReasoningSchema,
})
const FetchArgumentsSchema = z.object({
  url: HttpUrlSchema,
  reasoning: ToolReasoningSchema,
})
const MAX_RESEARCH_TOOL_CALLS = 3
const MAX_SAIL_REQUEST_RETRIES = 3
const RETRYABLE_SAIL_STATUSES = new Set([429, 500, 502, 503, 504])
const BASE_RETRY_DELAY_MS = 750
const MAX_RETRY_DELAY_MS = 12_000

const sleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Research cancelled'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Research cancelled'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })

const retryAfterMilliseconds = (response: Response): number | null => {
  const value = response.headers.get('retry-after')
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

const exponentialRetryDelay = (retry: number): number => {
  const bounded = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** retry))
  return Math.round(bounded * (0.75 + Math.random() * 0.5))
}

export class SailWorkerModel implements WorkerModel {
  readonly name: string

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.sailresearch.com/v1',
    private readonly model = 'deepseek-ai/DeepSeek-V4-Flash',
    private readonly inputUsdPerMillion?: number,
    private readonly outputUsdPerMillion?: number,
  ) {
    this.name = `sail:${model}`
  }

  async respond(turn: WorkerTurn, signal: AbortSignal): Promise<WorkerResponse> {
    const toolBudgetReached = turn.history.length >= MAX_RESEARCH_TOOL_CALLS
    // Sail's DeepSeek V4 Flash is ASAP-only and rejects background or idempotent requests.
    const response = await this.#request(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: 2_000,
        input: this.#prompt(turn),
        ...(toolBudgetReached ? {} : {
          tools: [
            {
              type: 'function',
              name: 'search',
              description: 'Search the public web for relevant sources.',
              strict: true,
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  reasoning: { type: 'string', description: 'One concise sentence explaining why this search is the next research step.' },
                },
                required: ['query', 'reasoning'],
                additionalProperties: false,
              },
            },
            {
              type: 'function',
              name: 'fetch',
              description: 'Fetch one relevant URL to inspect its content.',
              strict: true,
              parameters: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  reasoning: { type: 'string', description: 'One concise sentence explaining why this source should be opened next.' },
                },
                required: ['url', 'reasoning'],
                additionalProperties: false,
              },
            },
          ],
        }),
      }),
    }, signal, 'create', turn.onActivity)
    if (!response.ok) throw new Error(`Sail request failed with ${response.status}`)
    let payload = ResponseSchema.parse(await response.json())
    for (let poll = 0; payload.status === 'queued' || payload.status === 'in_progress'; poll += 1) {
      if (poll >= 300) throw new Error('Sail response timed out')
      await sleep(1_000, signal)
      const next = await this.#request(`${this.baseUrl}/responses/${encodeURIComponent(payload.id)}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      }, signal, 'poll', turn.onActivity)
      if (!next.ok) throw new Error(`Sail polling failed with ${next.status}`)
      payload = ResponseSchema.parse(await next.json())
    }
    if (payload.status !== 'completed') throw new Error(`Sail response ended as ${payload.status}`)
    const reasoningParts = payload.output
      .map((item) => ReasoningSchema.safeParse(item))
      .filter((item) => item.success)
      .flatMap((item) => [...item.data.summary, ...item.data.content])
      .map((item) => item.text.trim())
      .filter(Boolean)
    const reasoning = [...new Set(reasoningParts)].join('\n')
    const usage = payload.usage ? {
      id: `sail:${payload.id}`,
      inputTokens: payload.usage.input_tokens,
      outputTokens: payload.usage.output_tokens,
      costUsd: this.inputUsdPerMillion === undefined || this.outputUsdPerMillion === undefined
        ? null
        : (
            payload.usage.input_tokens * this.inputUsdPerMillion +
            payload.usage.output_tokens * this.outputUsdPerMillion
          ) / 1_000_000,
      provider: 'sail',
      model: this.model,
    } : undefined
    for (const item of payload.output) {
      const functionCall = FunctionCallSchema.safeParse(item)
      if (!functionCall.success) continue
      const parsedArguments: unknown = JSON.parse(functionCall.data.arguments)
      if (functionCall.data.name === 'search') {
        const arguments_ = SearchArgumentsSchema.parse(parsedArguments)
        return {
          kind: 'tool-call',
          call: { kind: 'search', ...arguments_ },
          reasoning: reasoning || arguments_.reasoning,
          ...(usage ? { usage } : {}),
        }
      }
      const arguments_ = FetchArgumentsSchema.parse(parsedArguments)
      return {
        kind: 'tool-call',
        call: { kind: 'fetch', ...arguments_ },
        reasoning: reasoning || arguments_.reasoning,
        ...(usage ? { usage } : {}),
      }
    }
    const finding = payload.output
      .map((item) => MessageSchema.safeParse(item))
      .filter((item) => item.success)
      .flatMap((item) => item.data.content)
      .map((content) => content.text)
      .join('')
      .trim()
    if (!finding) throw new Error('Sail returned no finding or tool call')
    return {
      kind: 'finding',
      finding,
      ...(reasoning ? { reasoning } : {}),
      ...(usage ? { usage } : {}),
    }
  }

  async #request(
    input: string,
    init: RequestInit,
    signal: AbortSignal,
    operation: 'create' | 'poll',
    onActivity: WorkerTurn['onActivity'],
  ): Promise<Response> {
    const maxAttempts = MAX_SAIL_REQUEST_RETRIES + 1
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(input, { ...init, signal })
      if (
        !RETRYABLE_SAIL_STATUSES.has(response.status) ||
        attempt === maxAttempts
      ) {
        return response
      }
      const delayMs = retryAfterMilliseconds(response) ?? exponentialRetryDelay(attempt - 1)
      fleetLog('warn', 'sail.request_retry', {
        model: this.model,
        operation,
        status: response.status,
        attempt,
        maxAttempts,
        delayMs,
      })
      onActivity?.({
        kind: 'retry',
        operation,
        status: response.status,
        retry: attempt,
        maxRetries: MAX_SAIL_REQUEST_RETRIES,
        delayMs,
      })
      await response.body?.cancel()
      await sleep(delayMs, signal)
    }
    throw new Error('Sail request retry loop exited unexpectedly')
  }

  #prompt(turn: WorkerTurn): string {
    return [
      'You are one researcher in Fleet. Investigate only your assigned objective.',
      `Question: ${turn.question}`,
      `Objective: ${turn.objective}`,
      `Evidence already collected: ${JSON.stringify(turn.history)}`,
      turn.history.length >= MAX_RESEARCH_TOOL_CALLS
        ? 'The research tool budget is exhausted. Return a concise source-aware finding now. Do not request another tool.'
        : `Use Search and Fetch when useful. Every tool call must include one concise sentence explaining why that tool is the next research step. You have ${MAX_RESEARCH_TOOL_CALLS - turn.history.length} tool calls remaining. Return a concise source-aware finding as soon as you have enough evidence.`,
    ].join('\n\n')
  }
}
