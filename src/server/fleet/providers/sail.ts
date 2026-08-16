import { z } from 'zod'
import type { WorkerModel, WorkerResponse, WorkerTurn } from '../ports'

const ResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'cancelled']),
  output: z.array(
    z.union([
      z.object({
        type: z.literal('function_call'),
        name: z.enum(['search', 'fetch']),
        arguments: z.string(),
      }),
      z.object({
        type: z.literal('message'),
        content: z.array(
          z.object({ type: z.literal('output_text'), text: z.string() }).passthrough(),
        ),
      }),
    ]),
  ).default([]),
})

const SearchArgumentsSchema = z.object({ query: z.string().min(1).max(200) })
const FetchArgumentsSchema = z.object({ url: z.string().url() })

const sleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Research cancelled'))
    }, { once: true })
  })

export class SailWorkerModel implements WorkerModel {
  readonly name: string

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.sailresearch.com/v1',
    private readonly model = 'deepseek-ai/DeepSeek-V4-Flash',
  ) {
    this.name = `sail:${model}`
  }

  async respond(turn: WorkerTurn, signal: AbortSignal): Promise<WorkerResponse> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `${turn.agentId}:${turn.history.length}`,
      },
      body: JSON.stringify({
        model: this.model,
        background: true,
        max_output_tokens: 2_000,
        metadata: { completion_window: 'asap' },
        input: this.#prompt(turn),
        tools: [
          {
            type: 'function',
            name: 'search',
            description: 'Search the public web for relevant sources.',
            strict: true,
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
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
              properties: { url: { type: 'string' } },
              required: ['url'],
              additionalProperties: false,
            },
          },
        ],
      }),
      signal,
    })
    if (!response.ok) throw new Error(`Sail request failed with ${response.status}`)
    let payload = ResponseSchema.parse(await response.json())
    for (let poll = 0; payload.status === 'queued' || payload.status === 'in_progress'; poll += 1) {
      if (poll >= 300) throw new Error('Sail response timed out')
      await sleep(1_000, signal)
      const next = await fetch(`${this.baseUrl}/responses/${encodeURIComponent(payload.id)}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal,
      })
      if (!next.ok) throw new Error(`Sail polling failed with ${next.status}`)
      payload = ResponseSchema.parse(await next.json())
    }
    if (payload.status !== 'completed') throw new Error(`Sail response ended as ${payload.status}`)
    for (const item of payload.output) {
      if (item.type !== 'function_call') continue
      const parsedArguments: unknown = JSON.parse(item.arguments)
      if (item.name === 'search') {
        return { kind: 'tool-call', call: { kind: 'search', ...SearchArgumentsSchema.parse(parsedArguments) } }
      }
      return { kind: 'tool-call', call: { kind: 'fetch', ...FetchArgumentsSchema.parse(parsedArguments) } }
    }
    const finding = payload.output
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content)
      .map((content) => content.text)
      .join('')
      .trim()
    if (!finding) throw new Error('Sail returned no finding or tool call')
    return { kind: 'finding', finding }
  }

  #prompt(turn: WorkerTurn): string {
    return [
      'You are one researcher in Fleet. Investigate only your assigned objective.',
      `Question: ${turn.question}`,
      `Objective: ${turn.objective}`,
      `Evidence already collected: ${JSON.stringify(turn.history)}`,
      'Use Search and Fetch when useful. Return a concise source-aware finding when finished.',
    ].join('\n\n')
  }
}
