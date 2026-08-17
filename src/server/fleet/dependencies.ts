import { z } from 'zod'
import type { RunProfile } from '../../lib/fleet-protocol'
import type { ResearchTools, Synthesizer, WorkerModel } from './ports'
import { BrowserbaseResearchTools } from './providers/browserbase'
import {
  DevelopmentResearchTools,
  DevelopmentSynthesizer,
  DevelopmentWorkerModel,
} from './providers/development'
import { GatewaySynthesizer } from './providers/gateway'
import { SailWorkerModel } from './providers/sail'

const OptionalNonnegativeNumber = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().nonnegative().optional(),
)

const EnvironmentSchema = z.object({
  SAIL_API_KEY: z.string().min(1).optional(),
  BROWSERBASE_API_KEY: z.string().min(1).optional(),
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  SAIL_BASE_URL: z.string().url().default('https://api.sailresearch.com/v1'),
  SAIL_RESEARCH_MODEL: z.string().default('deepseek-ai/DeepSeek-V4-Flash'),
  AI_GATEWAY_ORCHESTRATOR_MODEL: z.string().default('openai/gpt-5.6-sol'),
  SAIL_INPUT_USD_PER_MILLION: OptionalNonnegativeNumber,
  SAIL_OUTPUT_USD_PER_MILLION: OptionalNonnegativeNumber,
})

export class ProfileNotReadyError extends Error {}

export type FleetDependencies = {
  worker: WorkerModel
  tools: ResearchTools
  synthesizer: Synthesizer
}

export const createFleetDependencies = (
  profile: RunProfile,
  rawEnvironment: NodeJS.ProcessEnv = process.env,
): FleetDependencies => {
  const environment = EnvironmentSchema.parse(rawEnvironment)
  if (profile === 'development') {
    return {
      worker: new DevelopmentWorkerModel(),
      tools: new DevelopmentResearchTools(),
      synthesizer: new DevelopmentSynthesizer(),
    }
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
    environment.SAIL_INPUT_USD_PER_MILLION,
    environment.SAIL_OUTPUT_USD_PER_MILLION,
  )
  const tools = new BrowserbaseResearchTools(environment.BROWSERBASE_API_KEY)
  if (profile === 'live-workers') {
    return { worker, tools, synthesizer: new DevelopmentSynthesizer() }
  }
  if (!environment.AI_GATEWAY_API_KEY) {
    throw new ProfileNotReadyError('Live mode requires AI_GATEWAY_API_KEY.')
  }
  return {
    worker,
    tools,
    synthesizer: new GatewaySynthesizer(environment.AI_GATEWAY_ORCHESTRATOR_MODEL),
  }
}
