import {
  createAgentId,
  createToolCallId,
  type AgentId,
  type CreateRunInput,
  type RunId,
  type ToolTrace,
} from '../../lib/fleet-protocol'
import { FleetJournal } from './journal'
import { fleetLog } from './log'
import type {
  ResearchToolCall,
  ResearchToolResult,
  ResearchTools,
  Synthesizer,
  SynthesisInput,
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

const logAgentId = (agentId: AgentId): string =>
  agentId.slice(agentId.lastIndexOf(':') + 1)

export class RunCoordinator {
  readonly #active = new Set<RunId>()

  constructor(
    private readonly journal: FleetJournal,
    private readonly worker: WorkerModel,
    private readonly tools: ResearchTools,
    private readonly synthesizer: Synthesizer,
  ) {}

  async run(runId: RunId, input: CreateRunInput): Promise<void> {
    if (this.#active.has(runId)) {
      fleetLog('warn', 'run.duplicate_skipped', { run: runId })
      return
    }
    const runStartedAt = Date.now()
    this.#active.add(runId)
    const signal = new AbortController().signal
    fleetLog('info', 'run.started', {
      run: runId,
      profile: input.profile,
      agents: input.agentCount,
      concurrency: input.concurrency,
      worker: this.worker.name,
      synthesizer: this.synthesizer.name,
      question: input.question,
    })
    try {
      this.journal.append(runId, (metadata) => ({
        kind: 'orchestrator.activity',
        runId,
        ...metadata,
        phase: 'planning',
        message: `Breaking the question into ${input.agentCount} independent research ${input.agentCount === 1 ? 'angle' : 'angles'} before dispatch.`,
      }))
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
      fleetLog('info', 'run.planned', {
        run: runId,
        assignments: assignments.length,
      })
      this.journal.append(runId, (metadata) => ({
        kind: 'orchestrator.activity',
        runId,
        ...metadata,
        phase: 'dispatch',
        message: `Invoking ${assignments.length} ${assignments.length === 1 ? 'subagent' : 'subagents'} with up to ${input.concurrency} working in parallel.`,
      }))

      let cursor = 0
      const findings: SynthesisInput['findings'] = []
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
            if (finding) findings.push(finding)
          }
        },
      )
      await Promise.all(runners)
      this.journal.append(runId, (metadata) => ({
        kind: 'orchestrator.activity',
        runId,
        ...metadata,
        phase: 'review',
        message: `Reviewing ${findings.length} completed findings before final synthesis.`,
      }))
      if (findings.length === 0) {
        fleetLog('error', 'run.failed', {
          run: runId,
          durationMs: Date.now() - runStartedAt,
          error: 'Every research agent failed.',
        })
        this.journal.append(runId, (metadata) => ({
          kind: 'run.failed',
          runId,
          ...metadata,
          error: 'Every research agent failed.',
        }))
        return
      }
      const synthesisStartedAt = Date.now()
      fleetLog('info', 'synthesis.started', {
        run: runId,
        synthesizer: this.synthesizer.name,
        findings: findings.length,
      })
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
      fleetLog('info', 'synthesis.completed', {
        run: runId,
        durationMs: Date.now() - synthesisStartedAt,
        answerChars: answer.length,
      })
      fleetLog('info', 'run.completed', {
        run: runId,
        durationMs: Date.now() - runStartedAt,
        succeeded: findings.length,
        failed: input.agentCount - findings.length,
      })
    } catch (error) {
      const publicError = error instanceof Error ? error.message : 'Research failed'
      fleetLog('error', 'run.failed', {
        run: runId,
        durationMs: Date.now() - runStartedAt,
        error: publicError,
      })
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
  }): Promise<SynthesisInput['findings'][number] | null> {
    const agentStartedAt = Date.now()
    this.journal.append(args.runId, (metadata) => ({
      kind: 'agent.started',
      runId: args.runId,
      agentId: args.agentId,
      ...metadata,
    }))
    fleetLog('info', 'agent.started', {
      run: args.runId,
      agent: logAgentId(args.agentId),
      objective: args.objective,
    })
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
        const workerStartedAt = Date.now()
        const response = await this.worker.respond(
          {
            question: args.question,
            objective: args.objective,
            agentId: args.agentId,
            history,
          },
          args.signal,
        )
        fleetLog('info', 'worker.responded', {
          run: args.runId,
          agent: logAgentId(args.agentId),
          model: this.worker.name,
          turn: turn + 1,
          response: response.kind,
          durationMs: Date.now() - workerStartedAt,
        })
        const reasoning = response.reasoning?.trim() || (response.kind === 'tool-call'
          ? `Selected ${response.call.kind === 'search' ? 'Search' : 'Fetch'} as the next evidence step.`
          : 'Evidence review is complete; reporting the finding to the orchestrator.')
        this.journal.append(args.runId, (metadata) => ({
          kind: 'agent.reasoning',
          runId: args.runId,
          agentId: args.agentId,
          ...metadata,
          reasoning,
        }))
        if (response.kind === 'finding') {
          this.journal.append(args.runId, (metadata) => ({
            kind: 'agent.succeeded',
            runId: args.runId,
            agentId: args.agentId,
            ...metadata,
            finding: response.finding,
          }))
          fleetLog('info', 'agent.succeeded', {
            run: args.runId,
            agent: logAgentId(args.agentId),
            durationMs: Date.now() - agentStartedAt,
            toolCalls: history.length,
            findingChars: response.finding.length,
          })
          return {
            agentId: args.agentId,
            objective: args.objective,
            finding: response.finding,
            sources: synthesisSources(history),
          }
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
        fleetLog('info', 'tool.started', {
          run: args.runId,
          agent: logAgentId(args.agentId),
          tool: response.call.kind,
          input: runningTrace.input,
        })
        this.journal.append(args.runId, (metadata) => ({
          kind: 'tool.started',
          runId: args.runId,
          agentId: args.agentId,
          ...metadata,
          trace: runningTrace,
        }))
        try {
          const toolStartedAt = Date.now()
          const result = await this.tools.execute(response.call, args.signal)
          if (result.kind === 'error') throw new Error(result.message)
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
          fleetLog('info', 'tool.succeeded', {
            run: args.runId,
            agent: logAgentId(args.agentId),
            tool: response.call.kind,
            durationMs: Date.now() - toolStartedAt,
            results: result.kind === 'search' ? result.results.length : undefined,
            contentChars: result.kind === 'fetch' ? result.text.length : undefined,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool call failed'
          fleetLog('error', 'tool.failed', {
            run: args.runId,
            agent: logAgentId(args.agentId),
            tool: response.call.kind,
            error: message,
          })
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
          history.push({
            call: response.call,
            result: { kind: 'error', message },
          })
        }
      }
      throw new Error('Agent exceeded its tool-turn limit')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent failed'
      fleetLog('error', 'agent.failed', {
        run: args.runId,
        agent: logAgentId(args.agentId),
        durationMs: Date.now() - agentStartedAt,
        toolCalls: history.length,
        error: message,
      })
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

const synthesisSources = (
  history: Array<{ call: ResearchToolCall; result: ResearchToolResult }>,
): Array<{ title: string; url: string }> => {
  const sources = new Map<string, string>()
  for (const { result } of history) {
    if (result.kind === 'search') {
      for (const source of result.results) sources.set(source.url, source.title)
    } else if (result.kind === 'fetch') {
      sources.set(result.url, result.title)
    }
  }
  return Array.from(sources, ([url, title]) => ({ title, url }))
}
