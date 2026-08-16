import type {
  AgentSnapshot,
  FleetEvent,
  RunSnapshot,
  ToolTrace,
} from '../../lib/fleet-protocol'

export type ReplayResult =
  | { kind: 'applied'; snapshot: RunSnapshot }
  | { kind: 'duplicate'; snapshot: RunSnapshot }
  | { kind: 'gap'; expected: number; received: number; snapshot: RunSnapshot }

const replaceTrace = (trace: ToolTrace[], replacement: ToolTrace): ToolTrace[] => {
  const existing = trace.findIndex((entry) => entry.id === replacement.id)
  if (existing === -1) return [...trace, replacement]
  return trace.map((entry, index) => (index === existing ? replacement : entry))
}

type AgentUpdateEvent = Exclude<
  Extract<FleetEvent, { agentId: AgentSnapshot['id'] }>,
  { kind: 'agent.planned' }
>

const updateAgent = (
  agents: AgentSnapshot[],
  event: AgentUpdateEvent,
): AgentSnapshot[] =>
  agents.map((agent) => {
    if (agent.id !== event.agentId) return agent
    switch (event.kind) {
      case 'agent.started':
        return {
          ...agent,
          status: 'running',
          activity: 'Starting research',
          reasoning: [],
          trace: [],
          finding: null,
          error: null,
        }
      case 'agent.activity':
        return { ...agent, activity: event.activity }
      case 'agent.reasoning':
        return {
          ...agent,
          reasoning: [
            ...agent.reasoning,
            { sequence: event.sequence, at: event.at, text: event.reasoning },
          ],
        }
      case 'tool.started':
      case 'tool.succeeded':
      case 'tool.failed':
        return { ...agent, trace: replaceTrace(agent.trace, event.trace) }
      case 'agent.succeeded':
        return {
          ...agent,
          status: 'succeeded',
          activity: 'Reported findings',
          finding: event.finding,
        }
      case 'agent.failed':
        return { ...agent, status: 'failed', activity: 'Failed', error: event.error }
      default: {
        const exhaustive: never = event
        return exhaustive
      }
    }
  })

export const reduceEvent = (snapshot: RunSnapshot, event: FleetEvent): ReplayResult => {
  if (event.sequence <= snapshot.latestSequence) return { kind: 'duplicate', snapshot }
  if (event.sequence !== snapshot.latestSequence + 1) {
    return {
      kind: 'gap',
      expected: snapshot.latestSequence + 1,
      received: event.sequence,
      snapshot,
    }
  }

  let next: RunSnapshot
  switch (event.kind) {
    case 'run.accepted':
      next = snapshot
      break
    case 'agent.planned':
      next = {
        ...snapshot,
        agents: [
          ...snapshot.agents,
          {
            id: event.agentId,
            objective: event.objective,
            status: 'planned',
            activity: 'Waiting to start',
            reasoning: [],
            trace: [],
            finding: null,
            error: null,
          },
        ],
      }
      break
    case 'agent.started':
    case 'agent.activity':
    case 'agent.reasoning':
    case 'tool.started':
    case 'tool.succeeded':
    case 'tool.failed':
    case 'agent.succeeded':
    case 'agent.failed':
      next = { ...snapshot, agents: updateAgent(snapshot.agents, event) }
      break
    case 'orchestrator.activity':
      next = {
        ...snapshot,
        orchestratorTrace: [
          ...snapshot.orchestratorTrace,
          {
            sequence: event.sequence,
            at: event.at,
            phase: event.phase,
            message: event.message,
          },
        ],
      }
      break
    case 'orchestrator.reasoning.delta':
      next = {
        ...snapshot,
        orchestratorReasoning: snapshot.orchestratorReasoning + event.delta,
      }
      break
    case 'synthesis.started':
      next = {
        ...snapshot,
        status: 'synthesizing',
        synthesizer: event.synthesizer,
        orchestratorReasoning: '',
        partialAnswer: '',
      }
      break
    case 'synthesis.delta':
      next = { ...snapshot, partialAnswer: snapshot.partialAnswer + event.delta }
      break
    case 'run.completed':
      next = { ...snapshot, status: 'completed', finalAnswer: event.answer }
      break
    case 'run.failed':
      next = { ...snapshot, status: 'failed', error: event.error }
      break
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
  return {
    kind: 'applied',
    snapshot: { ...next, latestSequence: event.sequence },
  }
}

export const replayEvents = (events: FleetEvent[]): RunSnapshot | null => {
  const accepted = events.find((event) => event.kind === 'run.accepted')
  if (!accepted || accepted.kind !== 'run.accepted') return null
  let snapshot: RunSnapshot = {
    id: accepted.runId,
    question: accepted.question,
    agentCount: accepted.agentCount,
    concurrency: accepted.concurrency,
    profile: accepted.profile,
    status: 'running',
    orchestratorTrace: [],
    orchestratorReasoning: '',
    agents: [],
    partialAnswer: '',
    finalAnswer: null,
    synthesizer: null,
    error: null,
    latestSequence: 0,
  }
  for (const event of events) {
    const result = reduceEvent(snapshot, event)
    if (result.kind === 'gap') throw new Error(`Event gap at sequence ${result.expected}`)
    snapshot = result.snapshot
  }
  return snapshot
}
