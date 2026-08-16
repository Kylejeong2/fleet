import type { AgentId, SearchResult } from '../../lib/fleet-protocol'

export type ResearchToolCall =
  | { kind: 'search'; query: string; reasoning?: string }
  | { kind: 'fetch'; url: string; reasoning?: string }

export type ResearchToolResult =
  | { kind: 'search'; results: SearchResult[] }
  | { kind: 'fetch'; url: string; title: string; text: string }
  | { kind: 'error'; message: string }

export type WorkerTurn = {
  question: string
  objective: string
  agentId: AgentId
  history: Array<{
    call: ResearchToolCall
    result: ResearchToolResult
  }>
}

export type WorkerResponse =
  | { kind: 'tool-call'; call: ResearchToolCall; reasoning?: string }
  | { kind: 'finding'; finding: string; reasoning?: string }

export interface WorkerModel {
  readonly name: string
  respond(turn: WorkerTurn, signal: AbortSignal): Promise<WorkerResponse>
}

export interface ResearchTools {
  execute(call: ResearchToolCall, signal: AbortSignal): Promise<ResearchToolResult>
}

export type SynthesisInput = {
  question: string
  findings: Array<{
    agentId: AgentId
    objective: string
    finding: string
    sources: Array<{ title: string; url: string }>
  }>
}

export interface Synthesizer {
  readonly name: string
  stream(input: SynthesisInput, signal: AbortSignal): AsyncIterable<string>
}
