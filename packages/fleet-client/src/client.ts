import { z } from 'zod'
import {
  CreateRunInputSchema,
  FleetEventSchema,
  RunSnapshotSchema,
  type CreateRunInput,
  type RunId,
  type RunSnapshot,
} from './protocol.js'
import { reduceEvent } from './reducer.js'

const AcceptedCountSchema = z.number().int().min(1).max(3)
const SlackExecutionSchema = CreateRunInputSchema.pick({
  profile: true,
  agentCount: true,
  concurrency: true,
}).superRefine((value, ctx) => {
  const agents = AcceptedCountSchema.safeParse(value.agentCount)
  const concurrency = AcceptedCountSchema.safeParse(value.concurrency)
  if (!agents.success) ctx.addIssue({ code: 'custom', path: ['agentCount'], message: 'agentCount must be 1..3' })
  if (!concurrency.success) ctx.addIssue({ code: 'custom', path: ['concurrency'], message: 'concurrency must be 1..3' })
  if (value.concurrency > value.agentCount) ctx.addIssue({ code: 'custom', path: ['concurrency'], message: 'concurrency cannot exceed agentCount' })
})

export type SlackExecution = z.infer<typeof SlackExecutionSchema>
export type CreateFleetRun = Readonly<{
  question: string
  context?: string
  idempotencyKey: string
  execution: SlackExecution
}>
export type FleetProjection = Readonly<{
  snapshot: RunSnapshot
  cursor: number
  terminal: boolean
}>
export interface FleetClient {
  createRun(input: CreateFleetRun): Promise<RunSnapshot>
  getRun(runId: RunId): Promise<RunSnapshot>
  follow(runId: RunId, options: { after: number; signal: AbortSignal }): AsyncIterable<FleetProjection>
}

export class FleetHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const terminal = (snapshot: RunSnapshot) => snapshot.status === 'completed' || snapshot.status === 'failed'
const sleep = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }, { once: true })
})

const errorMessage = async (response: Response) => {
  try {
    const value = z.object({ error: z.string() }).safeParse(await response.json())
    return value.success ? value.data.error : `Fleet request failed (${response.status})`
  } catch {
    return `Fleet request failed (${response.status})`
  }
}

async function* parseSse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const result = await reader.read()
      buffer += decoder.decode(result.value, { stream: !result.done }).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        if (data) yield JSON.parse(data)
        boundary = buffer.indexOf('\n\n')
      }
      if (result.done) return
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export const createFleetClient = (config: {
  baseUrl: URL
  authorization: { kind: 'bearer'; token: string }
  fetch?: typeof fetch
}): FleetClient => {
  const request = config.fetch ?? fetch
  const headers = { authorization: `Bearer ${config.authorization.token}` }
  const snapshot = async (runId: RunId, signal?: AbortSignal) => {
    const response = await request(new URL(`/api/v1/runs/${runId}`, config.baseUrl), { headers, signal })
    if (!response.ok) throw new FleetHttpError(response.status, await errorMessage(response))
    return RunSnapshotSchema.parse(await response.json())
  }
  return {
    async createRun(input) {
      const execution = SlackExecutionSchema.parse(input.execution)
      const body: CreateRunInput = CreateRunInputSchema.parse({
        question: input.question,
        context: input.context,
        ...execution,
      })
      const serialized = JSON.stringify(body)
      for (let attempt = 0; ; attempt += 1) {
        const response = await request(new URL('/api/v1/runs', config.baseUrl), {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey },
          body: serialized,
        })
        if (response.status === 425 && attempt < 5) {
          const seconds = Number(response.headers.get('retry-after') ?? '1')
          await sleep(Number.isFinite(seconds) ? Math.max(0, seconds * 1_000) : 1_000)
          continue
        }
        if (!response.ok) throw new FleetHttpError(response.status, await errorMessage(response))
        return RunSnapshotSchema.parse(await response.json())
      }
    },
    getRun: snapshot,
    async *follow(runId, options) {
      let state = await snapshot(runId, options.signal)
      let cursor = Math.max(options.after, state.latestSequence)
      yield { snapshot: state, cursor, terminal: terminal(state) }
      if (terminal(state)) return
      while (!options.signal.aborted) {
        const url = new URL(`/api/v1/runs/${runId}/events`, config.baseUrl)
        url.searchParams.set('after', String(cursor))
        let response: Response
        try {
          response = await request(url, { headers: { ...headers, 'last-event-id': String(cursor) }, signal: options.signal })
        } catch (error) {
          if (options.signal.aborted) throw error
          await sleep(100, options.signal)
          continue
        }
        if (!response.ok || !response.body) throw new FleetHttpError(response.status, await errorMessage(response))
        for await (const raw of parseSse(response.body, options.signal)) {
          const event = FleetEventSchema.parse(raw)
          if (event.sequence <= cursor) continue
          const reduced = reduceEvent(state, event)
          if (reduced.kind === 'gap') {
            state = await snapshot(runId, options.signal)
            cursor = state.latestSequence
          } else {
            state = reduced.snapshot
            cursor = state.latestSequence
          }
          yield { snapshot: state, cursor, terminal: terminal(state) }
          if (terminal(state)) return
        }
        if (!terminal(state)) await sleep(100, options.signal)
      }
    },
  }
}
