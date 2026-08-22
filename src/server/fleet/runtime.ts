import { getRun, start } from 'workflow/api'
import {
  createEventSeq,
  materializeFleetEvent,
  parseRunId,
  type CreateRunInput,
  type FleetEventDraft,
  type RunId,
  type RunSnapshot,
} from '../../lib/fleet-protocol'
import {
  createRedisIdempotencyStore,
  type IdempotencyStore,
} from './idempotency'
import {
  createRedisCommand,
  RedisRunOwnershipStore,
  type RunOwnershipStore,
} from './ownership'
import type { FleetActor } from '../auth'
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
    actor: FleetActor
  }): Promise<RunSnapshot>
  getRun(actor: FleetActor, runId: RunId): Promise<RunSnapshot>
  createEventStream(
    actor: FleetActor,
    runId: RunId,
    after: number,
  ): Promise<ReadableStream<Uint8Array>>
}

class LocalFleetRuntime implements FleetRuntime {
  async createRun(args: {
    input: CreateRunInput
    idempotencyKey: string | null
    actor: FleetActor
  }): Promise<RunSnapshot> {
    return getFleetService().createRun(args)
  }

  async getRun(actor: FleetActor, runId: RunId): Promise<RunSnapshot> {
    return getFleetService().getRun(actor, runId)
  }

  async createEventStream(
    actor: FleetActor,
    runId: RunId,
    after: number,
  ): Promise<ReadableStream<Uint8Array>> {
    getFleetService().events(actor, runId, after)
    return createFleetEventStream(getFleetService(), actor, runId, after)
  }
}

export class WorkflowFleetRuntime implements FleetRuntime {
  constructor(
    private readonly idempotency: IdempotencyStore | null,
    private readonly ownership: RunOwnershipStore | null,
  ) {}

  async createRun(args: {
    input: CreateRunInput
    idempotencyKey: string | null
    actor: FleetActor
  }): Promise<RunSnapshot> {
    if (!this.idempotency || !this.ownership) {
      throw new ProfileNotReadyError(
        'Workflow mode requires a Redis integration for run ownership and idempotency.',
      )
    }
    if (!args.idempotencyKey) return this.startOwnedRun(args.input, args.actor)
    const reservation = await this.idempotency.reserve(
      args.actor.tenantId,
      args.idempotencyKey,
      args.input,
    )
    if (reservation.kind === 'conflict') {
      throw new IdempotencyConflictError(
        'That Idempotency-Key was already used with a different request.',
      )
    }
    if (reservation.kind === 'pending') {
      throw new RunStartPendingError('That research run is still being enqueued. Retry shortly.')
    }
    if (reservation.kind === 'existing') {
      return this.getRunOrAccepted(args.actor, reservation.runId, args.input)
    }
    let snapshot: RunSnapshot
    try {
      snapshot = await this.startOwnedRun(args.input, args.actor)
    } catch (error) {
      await this.idempotency.release(
        args.actor.tenantId,
        args.idempotencyKey,
        reservation.token,
        reservation.requestHash,
      )
      throw error
    }
    try {
      await retryIdempotencyCommit(() => this.idempotency!.commit(
        args.actor.tenantId,
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

  async getRun(actor: FleetActor, runId: RunId): Promise<RunSnapshot> {
    await this.assertOwnership(actor, runId)
    const run = getRun(runId)
    if (!(await run.exists)) throw new RunNotFoundError('Research run not found.')
    const events = await readAvailableEvents(runId)
    const snapshot = replayEvents(events)
    if (!snapshot) throw new RunNotFoundError('Research run has not started yet.')
    return snapshot
  }

  async createEventStream(
    actor: FleetActor,
    runId: RunId,
    after: number,
  ): Promise<ReadableStream<Uint8Array>> {
    await this.assertOwnership(actor, runId)
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

  private async startOwnedRun(
    input: CreateRunInput,
    actor: FleetActor,
  ): Promise<RunSnapshot> {
    const snapshot = await this.startRun(input)
    try {
      await this.ownership!.put(snapshot.id, actor)
    } catch (error) {
      await getRun(snapshot.id).cancel().catch(() => undefined)
      throw error
    }
    return snapshot
  }

  private async getRunOrAccepted(
    actor: FleetActor,
    runId: RunId,
    input: CreateRunInput,
  ): Promise<RunSnapshot> {
    try {
      return await this.getRun(actor, runId)
    } catch (error) {
      if (error instanceof RunNotFoundError) return acceptedSnapshot(runId, input)
      throw error
    }
  }

  private async assertOwnership(actor: FleetActor, runId: RunId): Promise<void> {
    if (!this.ownership || !(await this.ownership.owns(runId, actor.tenantId))) {
      throw new RunNotFoundError('Research run not found.')
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
    ...input,
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
  const command = hasRedis ? createRedisCommand(process.env) : null
  singleton = new WorkflowFleetRuntime(
    hasRedis ? createRedisIdempotencyStore(process.env) : null,
    command ? new RedisRunOwnershipStore(command) : null,
  )
  return singleton
}
