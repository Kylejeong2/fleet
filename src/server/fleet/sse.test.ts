import { describe, expect, it } from 'vitest'
import { createRunId, type CreateRunInput } from '../../lib/fleet-protocol'
import { RunCoordinator } from './coordinator'
import { FleetJournal } from './journal'
import type {
  ResearchTools,
  Synthesizer,
  SynthesisInput,
  WorkerModel,
  WorkerResponse,
} from './ports'
import { FleetService } from './service'
import { createFleetEventStream } from './sse'

class Worker implements WorkerModel {
  readonly name = 'worker'
  async respond(): Promise<WorkerResponse> {
    return { kind: 'finding', finding: 'Evidence' }
  }
}

class UnusedTools implements ResearchTools {
  async execute(): Promise<never> {
    throw new Error('Unexpected tool call')
  }
}

class Synthesis implements Synthesizer {
  readonly name = 'synthesis'
  async *stream(_input: SynthesisInput): AsyncIterable<string> {
    yield 'Final answer'
  }
}

describe('Fleet SSE stream', () => {
  it('replays only committed events after the supplied cursor', async () => {
    const journal = new FleetJournal(':memory:')
    const input: CreateRunInput = {
      question: 'What evidence exists?',
      agentCount: 1,
      concurrency: 1,
      profile: 'development',
    }
    const runId = createRunId()
    journal.createRun({ runId, input, idempotencyKey: null })
    const coordinator = new RunCoordinator(
      journal,
      new Worker(),
      new UnusedTools(),
      new Synthesis(),
    )
    await coordinator.run(runId, input)
    const service = new FleetService(journal, () => coordinator)
    const response = new Response(createFleetEventStream(service, runId, 1))
    const body = await response.text()
    expect(body).not.toContain('id: 1\n')
    expect(body).toContain('event: agent.planned')
    expect(body).toContain('event: run.completed')
    journal.close()
  })
})
