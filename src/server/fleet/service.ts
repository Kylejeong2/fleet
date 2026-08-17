import {
  createRunId,
  type CreateRunInput,
  type FleetEvent,
  type RunId,
  type RunProfile,
  type RunSnapshot,
} from '../../lib/fleet-protocol'
import type { FleetActor } from '../auth'
import { RunCoordinator } from './coordinator'
import { createFleetDependencies, ProfileNotReadyError } from './dependencies'
import { FleetJournal } from './journal'
import { replayEvents } from './reducer'
import {
  MemoryFleetPolicy,
  type AdmissionLease,
  type FleetPolicy,
} from './admission'
import { createRetentionConfig } from './retention'

export class IdempotencyConflictError extends Error {}
export class RunNotFoundError extends Error {}
export { ProfileNotReadyError } from './dependencies'

export class FleetService {
  readonly #coordinators = new Map<RunId, RunCoordinator>()
  constructor(
    readonly journal: FleetJournal,
    private readonly coordinatorFactory: (
      profile: RunProfile,
    ) => RunCoordinator,
    readonly policy: FleetPolicy = new MemoryFleetPolicy(),
  ) {}

  createRun(args: {
    input: CreateRunInput
    idempotencyKey: string | null
    actor: FleetActor
    lease: AdmissionLease
  }): RunSnapshot {
    const coordinator = this.coordinatorFactory(args.input.profile)
    const runId = createRunId()
    const result = this.journal.createRun({ runId, ...args })
    if (result.kind === 'conflict') {
      throw new IdempotencyConflictError(
        'That Idempotency-Key was already used with a different request.',
      )
    }
    const effectiveRunId = result.runId
    if (result.kind === 'created') {
      this.#coordinators.set(effectiveRunId, coordinator)
      void coordinator.run(effectiveRunId, args.input, {
        userId: args.actor.userId,
        onUsage: (usage) => this.policy.recordUsage(args.lease, effectiveRunId, usage),
      }).finally(() => {
        this.#coordinators.delete(effectiveRunId)
        return this.policy.release(args.lease)
      })
    } else {
      void this.policy.release(args.lease)
    }
    return this.getRun(args.actor, effectiveRunId)
  }

  getRun(actor: FleetActor, runId: RunId): RunSnapshot {
    this.assertOwnership(actor, runId)
    const snapshot = replayEvents(this.journal.read(runId))
    if (!snapshot) throw new RunNotFoundError('Research run not found.')
    return snapshot
  }

  events(actor: FleetActor, runId: RunId, after: number): FleetEvent[] {
    this.assertOwnership(actor, runId)
    return this.journal.read(runId, after)
  }

  usage(actor: FleetActor) {
    return this.policy.usage(actor)
  }

  async cancelRun(actor: FleetActor, runId: RunId): Promise<RunSnapshot> {
    const snapshot = this.getRun(actor, runId)
    if (isTerminal(snapshot)) return snapshot
    const coordinator = this.#coordinators.get(runId)
    if (coordinator?.cancel(runId)) return this.getRun(actor, runId)
    this.journal.append(runId, (metadata) => ({
      kind: 'run.cancelled',
      runId,
      ...metadata,
    }))
    return this.getRun(actor, runId)
  }

  private assertOwnership(actor: FleetActor, runId: RunId): void {
    if (!this.journal.ownsRun(runId, actor.tenantId)) {
      throw new RunNotFoundError('Research run not found.')
    }
  }
}

const isTerminal = (snapshot: RunSnapshot): boolean =>
  snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled'

export const createFleetService = (args?: {
  databasePath?: string
  environment?: NodeJS.ProcessEnv
}): FleetService => {
  const journal = new FleetJournal(args?.databasePath)
  const retention = createRetentionConfig(args?.environment)
  journal.cleanupExpired(new Date(Date.now() - retention.FLEET_RUN_RETENTION_DAYS * 86_400_000))
  return new FleetService(journal, (profile) => {
    const dependencies = createFleetDependencies(profile, args?.environment)
    return new RunCoordinator(journal, dependencies.worker, dependencies.tools, dependencies.synthesizer)
  })
}

let singleton: FleetService | undefined

export const getFleetService = (): FleetService => {
  singleton ??= createFleetService()
  return singleton
}
