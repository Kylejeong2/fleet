import {
  RetryableError,
  getStepMetadata,
  getWorkflowMetadata,
  getWritable,
} from 'workflow'
import {
  createAgentId,
  createToolCallId,
  parseRunId,
  type AgentId,
  type CreateRunInput,
  type FleetEventDraft,
  type RunId,
  type ToolTrace,
} from '../../lib/fleet-protocol'
import { planResearchLenses } from './coordinator'
import { createFleetDependencies } from './dependencies'
import { fleetLog } from './log'
import type {
  ResearchToolCall,
  ResearchToolResult,
  SynthesisInput,
} from './ports'
import type { FleetActor } from '../auth'
import {
  createAdmissionConfig,
  RedisFleetPolicy,
  type AdmissionLease,
} from './admission'
import { createRedisCommand } from './ownership'

type Assignment = { agentId: AgentId; objective: string }
type Finding = SynthesisInput['findings'][number]

const writeEvent = async (
  writer: WritableStreamDefaultWriter<FleetEventDraft>,
  event: FleetEventDraft,
): Promise<void> => writer.write(event)

const eventTime = (): string => new Date().toISOString()

export const createAssignments = (runId: RunId, count: number): Assignment[] =>
  planResearchLenses(count).map((objective, index) => ({
    agentId: createAgentId(runId, index),
    objective,
  }))

export const createBatches = <Value>(values: Value[], size: number): Value[][] => {
  const batches: Value[][] = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size))
  }
  return batches
}

async function planFleetStep(
  runId: RunId,
  input: CreateRunInput,
  writable: WritableStream<FleetEventDraft>,
): Promise<Assignment[]> {
  'use step'
  const writer = writable.getWriter()
  const assignments = createAssignments(runId, input.agentCount)
  try {
    await writeEvent(writer, {
      kind: 'run.accepted',
      runId,
      at: eventTime(),
      ...input,
    })
    await writeEvent(writer, {
      kind: 'orchestrator.activity',
      runId,
      at: eventTime(),
      phase: 'planning',
      message: `Breaking the question into ${input.agentCount} independent research ${input.agentCount === 1 ? 'angle' : 'angles'} before dispatch.`,
    })
    for (const assignment of assignments) {
      await writeEvent(writer, {
        kind: 'agent.planned',
        runId,
        at: eventTime(),
        ...assignment,
      })
    }
    await writeEvent(writer, {
      kind: 'orchestrator.activity',
      runId,
      at: eventTime(),
      phase: 'dispatch',
      message: `Invoking ${assignments.length} ${assignments.length === 1 ? 'subagent' : 'subagents'} with up to ${input.concurrency} working in parallel.`,
    })
    return assignments
  } finally {
    writer.releaseLock()
  }
}

async function researchAgentStep(
  runId: RunId,
  input: CreateRunInput,
  assignment: Assignment,
  writable: WritableStream<FleetEventDraft>,
  lease: AdmissionLease,
): Promise<Finding | null> {
  'use step'
  const { attempt } = getStepMetadata()
  const { worker, tools } = createFleetDependencies(input.profile)
  const writer = writable.getWriter()
  const history: Array<{ call: ResearchToolCall; result: ResearchToolResult }> = []
  const startedAt = Date.now()
  try {
    await writeEvent(writer, {
      kind: 'agent.started',
      runId,
      agentId: assignment.agentId,
      at: eventTime(),
    })
    fleetLog('info', 'workflow.agent.started', {
      run: runId,
      agent: assignment.agentId,
      attempt: attempt + 1,
    })
    for (let turn = 0; turn < 8; turn += 1) {
      await writeEvent(writer, {
        kind: 'agent.activity',
        runId,
        agentId: assignment.agentId,
        at: eventTime(),
        activity: turn === 0 ? 'Planning research' : 'Reviewing evidence',
      })
      const activityWrites: Array<Promise<void>> = []
      const response = await worker.respond(
        {
          question: input.question,
          objective: assignment.objective,
          agentId: assignment.agentId,
          history,
          onActivity: (activity) => {
            if (activity.kind !== 'retry') return
            const waitSeconds = Math.max(0.1, activity.delayMs / 1_000).toFixed(1)
            activityWrites.push(writeEvent(writer, {
              kind: 'agent.activity',
              runId,
              agentId: assignment.agentId,
              at: eventTime(),
              activity: `Inference overloaded · retry ${activity.retry} of ${activity.maxRetries} in ${waitSeconds}s`,
            }))
            activityWrites.push(writeEvent(writer, {
              kind: 'orchestrator.activity',
              runId,
              at: eventTime(),
              phase: 'recovery',
              message: `${assignment.agentId} received ${activity.status} from inference. Retrying ${activity.retry} of ${activity.maxRetries} in ${waitSeconds}s.`,
            }))
          },
        },
        new AbortController().signal,
      )
      if (response.usage) {
        await workflowPolicy().recordUsage(lease, runId, response.usage)
      }
      await Promise.all(activityWrites)
      const reasoning = response.reasoning?.trim() || (response.kind === 'tool-call'
        ? `Selected ${response.call.kind === 'search' ? 'Search' : 'Fetch'} as the next evidence step.`
        : 'Evidence review is complete; reporting the finding to the orchestrator.')
      await writeEvent(writer, {
        kind: 'agent.reasoning',
        runId,
        agentId: assignment.agentId,
        at: eventTime(),
        reasoning,
      })
      if (response.kind === 'finding') {
        await writeEvent(writer, {
          kind: 'agent.succeeded',
          runId,
          agentId: assignment.agentId,
          at: eventTime(),
          finding: response.finding,
        })
        fleetLog('info', 'workflow.agent.succeeded', {
          run: runId,
          agent: assignment.agentId,
          durationMs: Date.now() - startedAt,
          toolCalls: history.length,
        })
        return {
          agentId: assignment.agentId,
          objective: assignment.objective,
          finding: response.finding,
          sources: synthesisSources(history),
        }
      }
      const toolStartedAt = eventTime()
      const toolId = createToolCallId(assignment.agentId, history.length)
      const runningTrace: Extract<ToolTrace, { status: 'running' }> = {
        status: 'running',
        id: toolId,
        tool: response.call.kind,
        input: response.call.kind === 'search' ? response.call.query : response.call.url,
        startedAt: toolStartedAt,
      }
      await writeEvent(writer, {
        kind: 'tool.started',
        runId,
        agentId: assignment.agentId,
        at: eventTime(),
        trace: runningTrace,
      })
      try {
        const result = await tools.execute(response.call, new AbortController().signal)
        if (result.kind === 'error') throw new Error(result.message)
        history.push({ call: response.call, result })
        await writeEvent(writer, {
          kind: 'tool.succeeded',
          runId,
          agentId: assignment.agentId,
          at: eventTime(),
          trace: {
            ...runningTrace,
            status: 'succeeded',
            completedAt: eventTime(),
            result,
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool call failed'
        history.push({ call: response.call, result: { kind: 'error', message } })
        await writeEvent(writer, {
          kind: 'tool.failed',
          runId,
          agentId: assignment.agentId,
          at: eventTime(),
          trace: {
            ...runningTrace,
            status: 'failed',
            completedAt: eventTime(),
            error: message,
          },
        })
      }
    }
    throw new Error('Agent exceeded its tool-turn limit')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent failed'
    if (isTransientFailure(message) && attempt < 5) {
      const retrySeconds = Math.min(60, 2 ** attempt * 2)
      await writeEvent(writer, {
        kind: 'orchestrator.activity',
        runId,
        at: eventTime(),
        phase: 'recovery',
        message: `${assignment.agentId} is retrying as a durable step after a transient failure.`,
      })
      throw new RetryableError(message, { retryAfter: `${retrySeconds}s` })
    }
    await writeEvent(writer, {
      kind: 'agent.failed',
      runId,
      agentId: assignment.agentId,
      at: eventTime(),
      error: message,
    })
    await writeEvent(writer, {
      kind: 'orchestrator.activity',
      runId,
      at: eventTime(),
      phase: 'recovery',
      message: `${assignment.agentId} stopped after its recovery attempts: ${message}`,
    })
    return null
  } finally {
    writer.releaseLock()
  }
}

async function synthesizeStep(
  runId: RunId,
  input: CreateRunInput,
  findings: Finding[],
  writable: WritableStream<FleetEventDraft>,
  actor: FleetActor,
  lease: AdmissionLease,
): Promise<void> {
  'use step'
  const { attempt } = getStepMetadata()
  const { synthesizer } = createFleetDependencies(input.profile)
  const writer = writable.getWriter()
  let answer = ''
  try {
    await writeEvent(writer, {
      kind: 'orchestrator.activity',
      runId,
      at: eventTime(),
      phase: 'review',
      message: `Reviewing ${findings.length} completed findings before final synthesis.`,
    })
    await writeEvent(writer, {
      kind: 'synthesis.started',
      runId,
      at: eventTime(),
      synthesizer: synthesizer.name,
    })
    for await (const part of synthesizer.stream(
      { question: input.question, findings, userId: actor.userId, runId },
      new AbortController().signal,
    )) {
      if (part.kind === 'reasoning-delta') {
        await writeEvent(writer, {
          kind: 'orchestrator.reasoning.delta',
          runId,
          at: eventTime(),
          delta: part.delta,
        })
      } else if (part.kind === 'text-delta') {
        answer += part.delta
        await writeEvent(writer, {
          kind: 'synthesis.delta',
          runId,
          at: eventTime(),
          delta: part.delta,
        })
      } else {
        await workflowPolicy().recordUsage(lease, runId, part.usage)
      }
    }
    await writeEvent(writer, {
      kind: 'run.completed',
      runId,
      at: eventTime(),
      answer,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synthesis failed'
    if (attempt < 5) {
      throw new RetryableError(message, {
        retryAfter: `${Math.min(60, 2 ** attempt * 2)}s`,
      })
    }
    await writeEvent(writer, {
      kind: 'run.failed',
      runId,
      at: eventTime(),
      error: message,
    })
  } finally {
    writer.releaseLock()
  }
}

async function releaseAdmissionStep(lease: AdmissionLease): Promise<void> {
  'use step'
  await workflowPolicy().release(lease)
}

async function failEmptyFleetStep(
  runId: RunId,
  writable: WritableStream<FleetEventDraft>,
): Promise<void> {
  'use step'
  const writer = writable.getWriter()
  try {
    await writeEvent(writer, {
      kind: 'run.failed',
      runId,
      at: eventTime(),
      error: 'Every research agent failed.',
    })
  } finally {
    writer.releaseLock()
  }
}

export async function fleetResearchWorkflow(
  input: CreateRunInput,
  actor: FleetActor,
  lease: AdmissionLease,
): Promise<void> {
  'use workflow'
  const runId = parseRunId(getWorkflowMetadata().workflowRunId)
  const writable = getWritable<FleetEventDraft>()
  try {
    const assignments = await planFleetStep(runId, input, writable)
    const findings: Finding[] = []
    for (const batch of createBatches(assignments, input.concurrency)) {
      const results = await Promise.all(
        batch.map((assignment) => researchAgentStep(
          runId,
          input,
          assignment,
          writable,
          lease,
        )),
      )
      for (const finding of results) if (finding) findings.push(finding)
    }
    if (findings.length === 0) {
      await failEmptyFleetStep(runId, writable)
      return
    }
    await synthesizeStep(runId, input, findings, writable, actor, lease)
  } finally {
    await releaseAdmissionStep(lease)
  }
}

const workflowPolicy = (): RedisFleetPolicy => new RedisFleetPolicy(
  createRedisCommand(process.env),
  createAdmissionConfig(process.env),
)

const isTransientFailure = (message: string): boolean =>
  /\b(?:408|425|429|500|502|503|504)\b|overload|timeout|temporar|network|fetch failed/i.test(message)

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
