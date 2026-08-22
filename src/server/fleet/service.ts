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

export class IdempotencyConflictError extends Error {}
export class RunNotFoundError extends Error {}
export { ProfileNotReadyError } from './dependencies'

export class FleetService {
  constructor(
    readonly journal: FleetJournal,
    private readonly coordinatorFactory: (
      profile: RunProfile,
    ) => RunCoordinator,
  ) {}

  createRun(args: {
    input: CreateRunInput
    idempotencyKey: string | null
    actor: FleetActor
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
      void coordinator.run(effectiveRunId, args.input)
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

  private assertOwnership(actor: FleetActor, runId: RunId): void {
    if (!this.journal.ownsRun(runId, actor.tenantId)) {
      throw new RunNotFoundError('Research run not found.')
    }
  }
}

export const createFleetService = (args?: {
  databasePath?: string
  environment?: NodeJS.ProcessEnv
}): FleetService => {
  const journal = new FleetJournal(args?.databasePath)
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
