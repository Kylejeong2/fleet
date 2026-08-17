import { describe, expect, it } from 'vitest'
import { createRunId, type CreateRunInput } from '../../lib/fleet-protocol'
import { RunCoordinator } from './coordinator'
import { FleetJournal } from './journal'
import type {
  ResearchToolCall,
  ResearchToolResult,
  ResearchTools,
  Synthesizer,
  SynthesisInput,
  SynthesisStreamPart,
  WorkerModel,
  WorkerResponse,
  WorkerTurn,
} from './ports'
import { replayEvents } from './reducer'

class TrackingWorker implements WorkerModel {
  readonly name = 'tracking-worker'
  active = 0
  maximum = 0

  async respond(turn: WorkerTurn): Promise<WorkerResponse> {
    this.active += 1
    this.maximum = Math.max(this.maximum, this.active)
    await new Promise((resolve) => setTimeout(resolve, 8))
    this.active -= 1
    if (turn.agentId.endsWith('agent-2')) throw new Error('isolated worker failure')
    return { kind: 'finding', finding: `Finding from ${turn.objective}` }
  }
}

class ToolWorker implements WorkerModel {
  readonly name = 'tool-worker'

  async respond(turn: WorkerTurn): Promise<WorkerResponse> {
    return turn.history.length === 0
      ? { kind: 'tool-call', call: { kind: 'search', query: turn.question }, reasoning: 'I need a primary source first.' }
      : { kind: 'finding', finding: 'Finding after search', reasoning: 'The source is sufficient to report.' }
  }
}

class RecoveringToolWorker implements WorkerModel {
  readonly name = 'recovering-tool-worker'

  async respond(turn: WorkerTurn): Promise<WorkerResponse> {
    if (turn.history.length === 0) {
      return { kind: 'tool-call', call: { kind: 'search', query: turn.question } }
    }
    if (turn.history.length === 1) {
      return { kind: 'tool-call', call: { kind: 'fetch', url: 'https://blocked.example' } }
    }
    return { kind: 'finding', finding: 'Finding recovered from search evidence' }
  }
}

class RetryingWorker implements WorkerModel {
  readonly name = 'retrying-worker'

  async respond(turn: WorkerTurn): Promise<WorkerResponse> {
    turn.onActivity?.({
      kind: 'retry',
      operation: 'create',
      status: 503,
      retry: 1,
      maxRetries: 3,
      delayMs: 1_500,
    })
    return { kind: 'finding', finding: 'Recovered finding' }
  }
}

class Tools implements ResearchTools {
  async execute(call: ResearchToolCall): Promise<ResearchToolResult> {
    if (call.kind === 'fetch') {
      return { kind: 'fetch', url: call.url, title: 'Page', text: 'Body' }
    }
    return {
      kind: 'search',
      results: [{ title: 'Source', url: 'https://example.com', snippet: 'Evidence' }],
    }
  }
}

class FetchFailingTools extends Tools {
  override async execute(call: ResearchToolCall): Promise<ResearchToolResult> {
    if (call.kind === 'fetch') throw new Error('Fetched page returned 403')
    return super.execute(call)
  }
}

class CountingSynthesizer implements Synthesizer {
  readonly name = 'counting-synthesizer'
  handoffs = 0
  lastInput: SynthesisInput | null = null

  async *stream(input: SynthesisInput): AsyncIterable<SynthesisStreamPart> {
    this.handoffs += 1
    this.lastInput = input
    yield { kind: 'reasoning-delta', delta: 'Comparing the completed evidence.' }
    yield { kind: 'text-delta', delta: `Synthesized ${input.findings.length} findings` }
  }
}

const runInput = (agentCount: number, concurrency: number): CreateRunInput => ({
  question: 'What evidence exists?',
  agentCount,
  concurrency,
  profile: 'development',
})

const createAcceptedRun = (journal: FleetJournal, input: CreateRunInput) => {
  const runId = createRunId()
  journal.createRun({
    runId,
    input,
    idempotencyKey: null,
    actor: { tenantId: 'tenant_1', userId: 'user_1' },
  })
  return runId
}

describe('RunCoordinator', () => {
  it('aborts provider work and records cancellation as the terminal event', async () => {
    const journal = new FleetJournal(':memory:')
    const input = runInput(1, 1)
    const runId = createAcceptedRun(journal, input)
    const worker: WorkerModel = {
      name: 'blocking-worker',
      respond: async (_turn, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
    }
    const coordinator = new RunCoordinator(journal, worker, new Tools(), new CountingSynthesizer())
    const running = coordinator.run(runId, input)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(coordinator.cancel(runId)).toBe(true)
    await running
    const events = journal.read(runId)
    expect(events.at(-1)?.kind).toBe('run.cancelled')
    expect(replayEvents(events)?.status).toBe('cancelled')
    journal.close()
  })

  it('reports worker and synthesis usage through one run callback', async () => {
    const journal = new FleetJournal(':memory:')
    const input = runInput(1, 1)
    const runId = createAcceptedRun(journal, input)
    const charges: string[] = []
    const worker: WorkerModel = {
      name: 'metered-worker',
      async respond() {
        return {
          kind: 'finding',
          finding: 'Metered evidence',
          usage: {
            id: 'worker-usage',
            inputTokens: 10,
            outputTokens: 5,
            costUsd: 0.001,
            provider: 'test',
            model: 'worker',
          },
        }
      },
    }
    const synthesizer: Synthesizer = {
      name: 'metered-synthesizer',
      async *stream() {
        yield { kind: 'text-delta', delta: 'Answer' }
        yield {
          kind: 'usage',
          usage: {
            id: 'synthesis-usage',
            inputTokens: 20,
            outputTokens: 10,
            costUsd: 0.002,
            provider: 'test',
            model: 'synthesizer',
          },
        }
      },
    }

    await new RunCoordinator(journal, worker, new Tools(), synthesizer).run(
      runId,
      input,
      { onUsage: async (usage) => { charges.push(usage.id) } },
    )

    expect(charges).toEqual(['worker-usage', 'synthesis-usage'])
    journal.close()
  })

  it('researches follow-ups with prior conversation context while preserving the visible question', async () => {
    const journal = new FleetJournal(':memory:')
    const input = {
      ...runInput(1, 1),
      question: 'What changed since then?',
      context: 'Question: What is RevOps?\nAnswer: It aligns go-to-market teams.',
    }
    const runId = createAcceptedRun(journal, input)
    const synthesizer = new CountingSynthesizer()
    await new RunCoordinator(journal, new TrackingWorker(), new Tools(), synthesizer).run(runId, input)
    const snapshot = replayEvents(journal.read(runId))
    expect(snapshot?.question).toBe('What changed since then?')
    expect(synthesizer.lastInput?.question).toContain('It aligns go-to-market teams.')
    expect(synthesizer.lastInput?.question).toContain('Current follow-up question: What changed since then?')
    journal.close()
  })

  it('honors the exact concurrency bound, isolates failure, and synthesizes once', async () => {
    const journal = new FleetJournal(':memory:')
    const worker = new TrackingWorker()
    const synthesizer = new CountingSynthesizer()
    const input = runInput(7, 3)
    const runId = createAcceptedRun(journal, input)
    await new RunCoordinator(journal, worker, new Tools(), synthesizer).run(runId, input)
    const snapshot = replayEvents(journal.read(runId))
    expect(worker.maximum).toBe(3)
    expect(snapshot?.agents.filter((agent) => agent.status === 'failed')).toHaveLength(1)
    expect(snapshot?.agents.filter((agent) => agent.status === 'succeeded')).toHaveLength(6)
    expect(snapshot?.status).toBe('completed')
    expect(synthesizer.handoffs).toBe(1)
    journal.close()
  })

  it('records running and succeeded tool trace states through the journal', async () => {
    const journal = new FleetJournal(':memory:')
    const input = runInput(1, 1)
    const runId = createAcceptedRun(journal, input)
    const synthesizer = new CountingSynthesizer()
    await new RunCoordinator(
      journal,
      new ToolWorker(),
      new Tools(),
      synthesizer,
    ).run(runId, input)
    const events = journal.read(runId)
    expect(events.filter((event) => event.kind === 'orchestrator.activity').map((event) => event.phase)).toEqual([
      'planning',
      'dispatch',
      'review',
    ])
    expect(events.filter((event) => event.kind === 'agent.reasoning')).toHaveLength(2)
    expect(events.some((event) => event.kind === 'tool.started')).toBe(true)
    expect(events.some((event) => event.kind === 'tool.succeeded')).toBe(true)
    const snapshot = replayEvents(events)
    expect(snapshot?.agents[0]?.trace[0]?.status).toBe('succeeded')
    expect(snapshot?.agents[0]?.reasoning.map((entry) => entry.text)).toEqual([
      'I need a primary source first.',
      'The source is sufficient to report.',
    ])
    expect(snapshot?.orchestratorTrace.map((entry) => entry.phase)).toEqual([
      'planning',
      'dispatch',
      'review',
    ])
    expect(snapshot?.orchestratorReasoning).toBe('Comparing the completed evidence.')
    expect(snapshot?.finalAnswer).toBe('Synthesized 1 findings')
    expect(synthesizer.lastInput?.findings[0]?.agentId).toBe(snapshot?.agents[0]?.id)
    expect(synthesizer.lastInput?.findings[0]?.sources).toEqual([
      { title: 'Source', url: 'https://example.com' },
    ])
    journal.close()
  })

  it('records a failed tool call but lets the agent synthesize prior evidence', async () => {
    const journal = new FleetJournal(':memory:')
    const input = runInput(1, 1)
    const runId = createAcceptedRun(journal, input)
    const synthesizer = new CountingSynthesizer()

    await new RunCoordinator(
      journal,
      new RecoveringToolWorker(),
      new FetchFailingTools(),
      synthesizer,
    ).run(runId, input)

    const snapshot = replayEvents(journal.read(runId))
    expect(snapshot?.status).toBe('completed')
    expect(snapshot?.agents[0]?.trace.map((trace) => trace.status)).toEqual([
      'succeeded',
      'failed',
    ])
    expect(synthesizer.lastInput?.findings[0]?.sources).toEqual([
      { title: 'Source', url: 'https://example.com' },
    ])
    journal.close()
  })

  it('streams inference recovery attempts into the agent and orchestrator traces', async () => {
    const journal = new FleetJournal(':memory:')
    const input = runInput(1, 1)
    const runId = createAcceptedRun(journal, input)

    await new RunCoordinator(
      journal,
      new RetryingWorker(),
      new Tools(),
      new CountingSynthesizer(),
    ).run(runId, input)

    const snapshot = replayEvents(journal.read(runId))
    expect(snapshot?.agents[0]?.activity).toBe('Reported findings')
    expect(snapshot?.orchestratorTrace.some((entry) =>
      entry.phase === 'recovery' && entry.message.includes('503'),
    )).toBe(true)
    expect(journal.read(runId).some((event) =>
      event.kind === 'agent.activity' && event.activity.includes('retry 1 of 3'),
    )).toBe(true)
    journal.close()
  })
})
