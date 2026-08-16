import { z } from 'zod'
import {
  createRunId,
  type CreateRunInput,
  type FleetEvent,
  type RunId,
  type RunProfile,
  type RunSnapshot,
} from '../../lib/fleet-protocol'
import { RunCoordinator } from './coordinator'
import { FleetJournal } from './journal'
import { DevelopmentResearchTools, DevelopmentSynthesizer, DevelopmentWorkerModel } from './providers/development'
import { BrowserbaseResearchTools } from './providers/browserbase'
import { GatewaySynthesizer } from './providers/gateway'
import { SailWorkerModel } from './providers/sail'
import { replayEvents } from './reducer'

const EnvironmentSchema = z.object({
  SAIL_API_KEY: z.string().min(1).optional(),
  BROWSERBASE_API_KEY: z.string().min(1).optional(),
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  SAIL_BASE_URL: z.string().url().default('https://api.sailresearch.com/v1'),
  SAIL_RESEARCH_MODEL: z.string().default('deepseek-ai/DeepSeek-V4-Flash'),
  AI_GATEWAY_ORCHESTRATOR_MODEL: z.string().default('openai/gpt-5.6-sol'),
})

export class IdempotencyConflictError extends Error {}
export class RunNotFoundError extends Error {}
export class ProfileNotReadyError extends Error {}

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
    return this.getRun(effectiveRunId)
  }

  getRun(runId: RunId): RunSnapshot {
    const snapshot = replayEvents(this.journal.read(runId))
    if (!snapshot) throw new RunNotFoundError('Research run not found.')
    return snapshot
  }

  events(runId: RunId, after: number): FleetEvent[] {
    if (this.journal.read(runId, 0).length === 0) {
      throw new RunNotFoundError('Research run not found.')
    }
    return this.journal.read(runId, after)
  }
}

export const createFleetService = (args?: {
  databasePath?: string
  environment?: NodeJS.ProcessEnv
}): FleetService => {
  const environment = EnvironmentSchema.parse(args?.environment ?? process.env)
  const journal = new FleetJournal(args?.databasePath)
  return new FleetService(journal, (profile) => {
    if (profile === 'development') {
      return new RunCoordinator(
        journal,
        new DevelopmentWorkerModel(),
        new DevelopmentResearchTools(),
        new DevelopmentSynthesizer(),
      )
    }
    if (!environment.SAIL_API_KEY || !environment.BROWSERBASE_API_KEY) {
      throw new ProfileNotReadyError(
        'Live workers require SAIL_API_KEY and BROWSERBASE_API_KEY.',
      )
    }
    const worker = new SailWorkerModel(
      environment.SAIL_API_KEY,
      environment.SAIL_BASE_URL,
      environment.SAIL_RESEARCH_MODEL,
    )
    const tools = new BrowserbaseResearchTools(environment.BROWSERBASE_API_KEY)
    if (profile === 'live-workers') {
      return new RunCoordinator(journal, worker, tools, new DevelopmentSynthesizer())
    }
    if (!environment.AI_GATEWAY_API_KEY) {
      throw new ProfileNotReadyError('Live mode requires AI_GATEWAY_API_KEY.')
    }
    return new RunCoordinator(
      journal,
      worker,
      tools,
      new GatewaySynthesizer(environment.AI_GATEWAY_ORCHESTRATOR_MODEL),
    )
  })
}

let singleton: FleetService | undefined

export const getFleetService = (): FleetService => {
  singleton ??= createFleetService()
  return singleton
}
