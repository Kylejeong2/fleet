import ipaddr from 'ipaddr.js'
import { z } from 'zod'

const LocalRunIdPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const WorkflowRunIdPattern = 'wrun_[0-9A-HJKMNP-TV-Z]{26}'

export const RunIdSchema = z
  .string()
  .regex(new RegExp(`^(?:${LocalRunIdPattern}|${WorkflowRunIdPattern})$`, 'i'))
  .brand<'RunId'>()
export type RunId = z.infer<typeof RunIdSchema>

export const AgentIdSchema = z
  .string()
  .regex(new RegExp(`^(?:${LocalRunIdPattern}|${WorkflowRunIdPattern}):agent-[1-9][0-9]*$`, 'i'))
  .brand<'AgentId'>()
export type AgentId = z.infer<typeof AgentIdSchema>

export const ToolCallIdSchema = z
  .string()
  .regex(new RegExp(`^(?:${LocalRunIdPattern}|${WorkflowRunIdPattern}):agent-[1-9][0-9]*:tool-[1-9][0-9]*$`, 'i'))
  .brand<'ToolCallId'>()
export type ToolCallId = z.infer<typeof ToolCallIdSchema>

export const EventSeqSchema = z.number().int().positive().brand<'EventSeq'>()
export type EventSeq = z.infer<typeof EventSeqSchema>

export const isPublicIpAddress = (address: string): boolean => {
  try {
    return ipaddr.process(address.replace(/^\[|\]$/g, '')).range() === 'unicast'
  } catch {
    return false
  }
}

const isPublicHttpUrl = (value: string): boolean => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return false
  }
  if (hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname)) {
    return isPublicIpAddress(hostname)
  }
  return hostname.includes('.')
}

export const HttpUrlSchema = z.string().url().refine(isPublicHttpUrl, {
  message: 'URL must be a public HTTP or HTTPS URL',
})

export const parseRunId = (value: unknown): RunId => RunIdSchema.parse(value)
export const createRunId = (): RunId => RunIdSchema.parse(crypto.randomUUID())
export const createAgentId = (runId: RunId, index: number): AgentId =>
  AgentIdSchema.parse(`${runId}:agent-${index + 1}`)
export const createToolCallId = (
  agentId: AgentId,
  index: number,
): ToolCallId => ToolCallIdSchema.parse(`${agentId}:tool-${index + 1}`)
export const createEventSeq = (value: number): EventSeq => EventSeqSchema.parse(value)

export const RunProfileSchema = z.enum(['development', 'live-workers', 'live'])
export type RunProfile = z.infer<typeof RunProfileSchema>

export const CreateRunInputSchema = z.object({
  question: z.string().trim().min(3).max(10_000),
  agentCount: z.number().int().min(1).max(100),
  concurrency: z.number().int().min(1).max(8),
  profile: RunProfileSchema,
})
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>

const SearchResultSchema = z.object({
  title: z.string(),
  url: HttpUrlSchema,
  snippet: z.string(),
})
export type SearchResult = z.infer<typeof SearchResultSchema>

const RunningToolTraceSchema = z.object({
    status: z.literal('running'),
    id: ToolCallIdSchema,
    tool: z.enum(['search', 'fetch']),
    input: z.string(),
    startedAt: z.string().datetime(),
  })
const SucceededToolTraceSchema = z.object({
    status: z.literal('succeeded'),
    id: ToolCallIdSchema,
    tool: z.enum(['search', 'fetch']),
    input: z.string(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    result: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('search'), results: z.array(SearchResultSchema) }),
      z.object({
        kind: z.literal('fetch'),
        url: HttpUrlSchema,
        title: z.string(),
        text: z.string(),
      }),
    ]),
  })
const FailedToolTraceSchema = z.object({
    status: z.literal('failed'),
    id: ToolCallIdSchema,
    tool: z.enum(['search', 'fetch']),
    input: z.string(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    error: z.string(),
  })
const ToolTraceSchema = z.discriminatedUnion('status', [
  RunningToolTraceSchema,
  SucceededToolTraceSchema,
  FailedToolTraceSchema,
])
export type ToolTrace = z.infer<typeof ToolTraceSchema>

const ReasoningEntrySchema = z.object({
  sequence: EventSeqSchema,
  at: z.string().datetime(),
  text: z.string(),
})

const OrchestratorEntrySchema = z.object({
  sequence: EventSeqSchema,
  at: z.string().datetime(),
  phase: z.enum(['planning', 'dispatch', 'recovery', 'review']),
  message: z.string(),
})

const EventBase = {
  runId: RunIdSchema,
  sequence: EventSeqSchema,
  at: z.string().datetime(),
}

export const FleetEventSchema = z.discriminatedUnion('kind', [
  z.object({
    ...EventBase,
    kind: z.literal('run.accepted'),
    question: z.string(),
    agentCount: z.number().int(),
    concurrency: z.number().int(),
    profile: RunProfileSchema,
  }),
  z.object({
    ...EventBase,
    kind: z.literal('agent.planned'),
    agentId: AgentIdSchema,
    objective: z.string(),
  }),
  z.object({ ...EventBase, kind: z.literal('agent.started'), agentId: AgentIdSchema }),
  z.object({
    ...EventBase,
    kind: z.literal('agent.activity'),
    agentId: AgentIdSchema,
    activity: z.string(),
  }),
  z.object({
    ...EventBase,
    kind: z.literal('agent.reasoning'),
    agentId: AgentIdSchema,
    reasoning: z.string(),
  }),
  z.object({
    ...EventBase,
    kind: z.literal('orchestrator.activity'),
    phase: z.enum(['planning', 'dispatch', 'recovery', 'review']),
    message: z.string(),
  }),
  z.object({
    ...EventBase,
    kind: z.literal('orchestrator.reasoning.delta'),
    delta: z.string(),
  }),
  z.object({
    ...EventBase,
    kind: z.literal('tool.started'),
    agentId: AgentIdSchema,
    trace: RunningToolTraceSchema,
  }),
  z.object({
    ...EventBase,
    kind: z.literal('tool.succeeded'),
    agentId: AgentIdSchema,
    trace: SucceededToolTraceSchema,
  }),
  z.object({
    ...EventBase,
    kind: z.literal('tool.failed'),
    agentId: AgentIdSchema,
    trace: FailedToolTraceSchema,
  }),
  z.object({
    ...EventBase,
    kind: z.literal('agent.succeeded'),
    agentId: AgentIdSchema,
    finding: z.string(),
  }),
  z.object({
    ...EventBase,
    kind: z.literal('agent.failed'),
    agentId: AgentIdSchema,
    error: z.string(),
  }),
  z.object({
    ...EventBase,
    kind: z.literal('synthesis.started'),
    synthesizer: z.string(),
  }),
  z.object({ ...EventBase, kind: z.literal('synthesis.delta'), delta: z.string() }),
  z.object({ ...EventBase, kind: z.literal('run.completed'), answer: z.string() }),
  z.object({ ...EventBase, kind: z.literal('run.failed'), error: z.string() }),
])
export type FleetEvent = z.infer<typeof FleetEventSchema>
export type FleetEventDraft = FleetEvent extends infer Event
  ? Event extends FleetEvent
    ? Omit<Event, 'sequence'>
    : never
  : never

export const materializeFleetEvent = (
  draft: FleetEventDraft,
  sequence: number,
): FleetEvent => parseFleetEvent({ ...draft, sequence: createEventSeq(sequence) })

const AgentSnapshotSchema = z.object({
  id: AgentIdSchema,
  objective: z.string(),
  status: z.enum(['planned', 'running', 'succeeded', 'failed']),
  activity: z.string(),
  reasoning: z.array(ReasoningEntrySchema),
  trace: z.array(ToolTraceSchema),
  finding: z.string().nullable(),
  error: z.string().nullable(),
})
export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>

export const RunSnapshotSchema = z.object({
  id: RunIdSchema,
  question: z.string(),
  agentCount: z.number().int(),
  concurrency: z.number().int(),
  profile: RunProfileSchema,
  status: z.enum(['running', 'synthesizing', 'completed', 'failed']),
  orchestratorTrace: z.array(OrchestratorEntrySchema),
  orchestratorReasoning: z.string(),
  agents: z.array(AgentSnapshotSchema),
  partialAnswer: z.string(),
  finalAnswer: z.string().nullable(),
  synthesizer: z.string().nullable(),
  error: z.string().nullable(),
  latestSequence: z.number().int().nonnegative(),
})
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>

export const parseFleetEvent = (value: unknown): FleetEvent => FleetEventSchema.parse(value)
