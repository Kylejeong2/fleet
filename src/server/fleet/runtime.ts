import { getRun, start } from 'workflow/api'
import {
  createEventSeq,
  materializeFleetEvent,
  parseRunId,
  publicRunInput,
  type CreateRunInput,
  type FleetEventDraft,
  type RunId,
  type RunSnapshot,
} from '../../lib/fleet-protocol'
import {
  createRedisIdempotencyStore,
  type IdempotencyStore,
} from './idempotency'
import { replayEvents } from './reducer'
import {
  getFleetService,
  IdempotencyConflictError,
  RunNotFoundError,
} from './service'
import { createFleetEventStream, serializeFleetEvent } from './sse'
import { ProfileNotReadyError } from './dependencies'
import { fleetResearchWorkflow } from './workflow'

export class RunStartPendingError extends Error {}

export interface FleetRuntime {
  createRun(args: {
    input: CreateRunInput
    idempotencyKey: string | null
  }): Promise<RunSnapshot>
  getRun(runId: RunId): Promise<RunSnapshot>
  createEventStream(runId: RunId, after: number): Promise<ReadableStream<Uint8Array>>
}

class LocalFleetRuntime implements FleetRuntime {
  async createRun(args: {
    input: CreateRunInput
    idempotencyKey: string | null
  }): Promise<RunSnapshot> {
    return getFleetService().createRun(args)
  }

  async getRun(runId: RunId): Promise<RunSnapshot> {
    return getFleetService().getRun(runId)
  }

  async createEventStream(runId: RunId, after: number): Promise<ReadableStream<Uint8Array>> {
    getFleetService().events(runId, after)
    return createFleetEventStream(getFleetService(), runId, after)
  }
}

export class WorkflowFleetRuntime implements FleetRuntime {
  constructor(private readonly idempotency: IdempotencyStore | null) {}

  async createRun(args: {
    input: CreateRunInput
    idempotencyKey: string | null
  }): Promise<RunSnapshot> {
    if (!args.idempotencyKey) return this.startRun(args.input)
    if (!this.idempotency) {
      throw new ProfileNotReadyError(
        'Workflow mode requires a Redis integration for durable idempotency.',
      )
    }
    const reservation = await this.idempotency.reserve(args.idempotencyKey, args.input)
    if (reservation.kind === 'conflict') {
      throw new IdempotencyConflictError(
        'That Idempotency-Key was already used with a different request.',
      )
    }
    if (reservation.kind === 'pending') {
      throw new RunStartPendingError('That research run is still being enqueued. Retry shortly.')
    }
    if (reservation.kind === 'existing') {
      return this.getRunOrAccepted(reservation.runId, args.input)
    }
    let snapshot: RunSnapshot
    try {
      snapshot = await this.startRun(args.input)
    } catch (error) {
      await this.idempotency.release(
        args.idempotencyKey,
        reservation.token,
        reservation.requestHash,
      )
      throw error
    }
    try {
      await retryIdempotencyCommit(() => this.idempotency!.commit(
        args.idempotencyKey!,
        reservation.token,
        reservation.requestHash,
        snapshot.id,
      ))
    } catch (error) {
      console.error('[fleet] workflow started but its idempotency record could not be committed', {
        runId: snapshot.id,
        error,
      })
    }
    return snapshot
  }

  async getRun(runId: RunId): Promise<RunSnapshot> {
    const run = getRun(runId)
    if (!(await run.exists)) throw new RunNotFoundError('Research run not found.')
    const events = await readAvailableEvents(runId)
    const snapshot = replayEvents(events)
    if (!snapshot) throw new RunNotFoundError('Research run has not started yet.')
    return snapshot
  }

  async createEventStream(runId: RunId, after: number): Promise<ReadableStream<Uint8Array>> {
    const run = getRun(runId)
    if (!(await run.exists)) throw new RunNotFoundError('Research run not found.')
    const source = run.getReadable<FleetEventDraft>({ startIndex: after })
    let sequence = after
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = source.getReader()
        try {
          while (true) {
            const result = await reader.read()
            if (result.done) break
            sequence += 1
            const event = materializeFleetEvent(result.value, sequence)
            controller.enqueue(serializeFleetEvent(event))
            if (event.kind === 'run.completed' || event.kind === 'run.failed') {
              await reader.cancel()
              break
            }
          }
          controller.close()
        } catch (error) {
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      },
    })
  }

  private async startRun(input: CreateRunInput): Promise<RunSnapshot> {
    const run = await start(fleetResearchWorkflow, [input])
    return acceptedSnapshot(parseRunId(run.runId), input)
  }

  private async getRunOrAccepted(runId: RunId, input: CreateRunInput): Promise<RunSnapshot> {
    try {
      return await this.getRun(runId)
    } catch (error) {
      if (error instanceof RunNotFoundError) return acceptedSnapshot(runId, input)
      throw error
    }
  }
}

const retryIdempotencyCommit = async (commit: () => Promise<void>): Promise<void> => {
  let lastError: unknown
  for (const delay of [0, 100, 500]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      await commit()
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

const readAvailableEvents = async (runId: RunId) => {
  const readable = getRun(runId).getReadable<FleetEventDraft>({ startIndex: 0 })
  const tail = await readable.getTailIndex()
  if (tail < 0) return []
  const reader = readable.getReader()
  const events = []
  try {
    for (let index = 0; index <= tail; index += 1) {
      const result = await reader.read()
      if (result.done) break
      events.push(materializeFleetEvent(result.value, index + 1))
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return events
}

const acceptedSnapshot = (runId: RunId, input: CreateRunInput): RunSnapshot => {
  const snapshot = replayEvents([{
    kind: 'run.accepted',
    runId,
    sequence: createEventSeq(1),
    at: new Date().toISOString(),
    ...publicRunInput(input),
  }])
  if (!snapshot) throw new Error('Could not create the accepted run snapshot.')
  return snapshot
}

let singleton: FleetRuntime | undefined

export const getFleetRuntime = (): FleetRuntime => {
  if (singleton) return singleton
  const workflowMode = process.env.FLEET_EXECUTION_MODE === 'workflow' || (
    process.env.FLEET_EXECUTION_MODE !== 'local' && Boolean(process.env.VERCEL)
  )
  if (!workflowMode) {
    singleton = new LocalFleetRuntime()
    return singleton
  }
  const hasRedis = Boolean(
    (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN),
  )
  singleton = new WorkflowFleetRuntime(
    hasRedis ? createRedisIdempotencyStore(process.env) : null,
  )
  return singleton
}
