import {
  createAgentId,
  createToolCallId,
  type AgentId,
  type CreateRunInput,
  type RunId,
  type ToolTrace,
} from '../../lib/fleet-protocol'
import { FleetJournal } from './journal'
import type {
  ResearchToolCall,
  ResearchToolResult,
  ResearchTools,
  Synthesizer,
  WorkerModel,
} from './ports'

const LENSES = [
  'definitions and framing',
  'primary-source evidence',
  'historical context',
  'current landscape',
  'quantitative evidence',
  'contradictory evidence',
  'expert consensus and disagreement',
  'stakeholder incentives',
  'technical feasibility',
  'economic implications',
  'legal and policy constraints',
  'geographic variation',
  'edge cases and failure modes',
  'second-order effects',
  'credible minority interpretations',
  'implementation examples',
  'comparative alternatives',
  'unknowns and evidence gaps',
  'future scenarios',
  'claims requiring verification',
]

export const planResearchLenses = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => {
    const lens = LENSES[index % LENSES.length]
    const pass = Math.floor(index / LENSES.length) + 1
    return `Investigate ${lens}; independent coverage pass ${pass}`
  })

export class RunCoordinator {
  readonly #active = new Set<RunId>()

  constructor(
    private readonly journal: FleetJournal,
    private readonly worker: WorkerModel,
    private readonly tools: ResearchTools,
    private readonly synthesizer: Synthesizer,
  ) {}

  async run(runId: RunId, input: CreateRunInput): Promise<void> {
    if (this.#active.has(runId)) return
    this.#active.add(runId)
    const signal = new AbortController().signal
    try {
      const assignments = planResearchLenses(input.agentCount).map((objective, index) => ({
        agentId: createAgentId(runId, index),
        objective,
      }))
      for (const assignment of assignments) {
        this.journal.append(runId, (metadata) => ({
          kind: 'agent.planned',
          runId,
          ...metadata,
          ...assignment,
        }))
      }

      let cursor = 0
      const findings: Array<{ objective: string; finding: string }> = []
      const runners = Array.from(
        { length: Math.min(input.concurrency, assignments.length) },
        async () => {
          while (cursor < assignments.length) {
            const assignment = assignments[cursor]
            cursor += 1
            if (!assignment) continue
            const finding = await this.#runAgent({
              runId,
              question: input.question,
              ...assignment,
              signal,
            })
            if (finding) findings.push({ objective: assignment.objective, finding })
          }
        },
      )
      await Promise.all(runners)
      if (findings.length === 0) {
        this.journal.append(runId, (metadata) => ({
          kind: 'run.failed',
          runId,
          ...metadata,
          error: 'Every research agent failed.',
        }))
        return
      }
      this.journal.append(runId, (metadata) => ({
        kind: 'synthesis.started',
        runId,
        ...metadata,
        synthesizer: this.synthesizer.name,
      }))
      let answer = ''
      for await (const delta of this.synthesizer.stream(
        { question: input.question, findings },
        signal,
      )) {
        answer += delta
        this.journal.append(runId, (metadata) => ({
          kind: 'synthesis.delta',
          runId,
          ...metadata,
          delta,
        }))
      }
      this.journal.append(runId, (metadata) => ({
        kind: 'run.completed',
        runId,
        ...metadata,
        answer,
      }))
    } catch (error) {
      const publicError = error instanceof Error ? error.message : 'Research failed'
      this.journal.append(runId, (metadata) => ({
        kind: 'run.failed',
        runId,
        ...metadata,
        error: publicError,
      }))
    } finally {
      this.#active.delete(runId)
    }
  }

  async #runAgent(args: {
    runId: RunId
    agentId: AgentId
    objective: string
    question: string
    signal: AbortSignal
  }): Promise<string | null> {
    this.journal.append(args.runId, (metadata) => ({
      kind: 'agent.started',
      runId: args.runId,
      agentId: args.agentId,
      ...metadata,
    }))
    const history: Array<{ call: ResearchToolCall; result: ResearchToolResult }> = []
    try {
      for (let turn = 0; turn < 8; turn += 1) {
        this.journal.append(args.runId, (metadata) => ({
          kind: 'agent.activity',
          runId: args.runId,
          agentId: args.agentId,
          ...metadata,
          activity: turn === 0 ? 'Planning research' : 'Reviewing evidence',
        }))
        const response = await this.worker.respond(
          {
            question: args.question,
            objective: args.objective,
            agentId: args.agentId,
            history,
          },
          args.signal,
        )
        if (response.kind === 'finding') {
          this.journal.append(args.runId, (metadata) => ({
            kind: 'agent.succeeded',
            runId: args.runId,
            agentId: args.agentId,
            ...metadata,
            finding: response.finding,
          }))
          return response.finding
        }
        const startedAt = new Date().toISOString()
        const toolId = createToolCallId(args.agentId, history.length)
        const runningTrace: Extract<ToolTrace, { status: 'running' }> = {
          status: 'running',
          id: toolId,
          tool: response.call.kind,
          input: response.call.kind === 'search' ? response.call.query : response.call.url,
          startedAt,
        }
        this.journal.append(args.runId, (metadata) => ({
          kind: 'tool.started',
          runId: args.runId,
          agentId: args.agentId,
          ...metadata,
          trace: runningTrace,
        }))
        try {
          const result = await this.tools.execute(response.call, args.signal)
          history.push({ call: response.call, result })
          this.journal.append(args.runId, (metadata) => ({
            kind: 'tool.succeeded',
            runId: args.runId,
            agentId: args.agentId,
            ...metadata,
            trace: {
              ...runningTrace,
              status: 'succeeded',
              completedAt: new Date().toISOString(),
              result,
            },
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool call failed'
          this.journal.append(args.runId, (metadata) => ({
            kind: 'tool.failed',
            runId: args.runId,
            agentId: args.agentId,
            ...metadata,
            trace: {
              ...runningTrace,
              status: 'failed',
              completedAt: new Date().toISOString(),
              error: message,
            },
          }))
          throw error
        }
      }
      throw new Error('Agent exceeded its tool-turn limit')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent failed'
      this.journal.append(args.runId, (metadata) => ({
        kind: 'agent.failed',
        runId: args.runId,
        agentId: args.agentId,
        ...metadata,
        error: message,
      }))
      return null
    }
  }
}
