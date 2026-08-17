import type { AgentId, RunId, SearchResult } from '../../lib/fleet-protocol'

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
  onActivity?: (activity: WorkerActivity) => void
}

export type WorkerActivity = {
  kind: 'retry'
  operation: 'create' | 'poll'
  status: number
  retry: number
  maxRetries: number
  delayMs: number
}

export type WorkerResponse =
  | { kind: 'tool-call'; call: ResearchToolCall; reasoning?: string; usage?: ProviderUsage }
  | { kind: 'finding'; finding: string; reasoning?: string; usage?: ProviderUsage }

export type ProviderUsage = {
  id: string
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  provider: string
  model: string
}

export interface WorkerModel {
  readonly name: string
  respond(turn: WorkerTurn, signal: AbortSignal): Promise<WorkerResponse>
}

export interface ResearchTools {
  execute(call: ResearchToolCall, signal: AbortSignal): Promise<ResearchToolResult>
}

export type SynthesisInput = {
  question: string
  userId?: string
  runId?: RunId
  findings: Array<{
    agentId: AgentId
    objective: string
    finding: string
    sources: Array<{ title: string; url: string }>
  }>
}

export type SynthesisStreamPart =
  | { kind: 'reasoning-delta'; delta: string }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'usage'; usage: ProviderUsage }

export interface Synthesizer {
  readonly name: string
  stream(input: SynthesisInput, signal: AbortSignal): AsyncIterable<SynthesisStreamPart>
}
