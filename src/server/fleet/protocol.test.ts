import { describe, expect, it } from 'vitest'
import {
  createAgentId,
  createEventSeq,
  createRunId,
  createToolCallId,
  CreateRunInputSchema,
  HttpUrlSchema,
  isPublicIpAddress,
  parseRunId,
  type FleetEvent,
  type RunSnapshot,
} from '../../lib/fleet-protocol'
import { reduceEvent, replayEvents } from './reducer'

const acceptedEvent = (): Extract<FleetEvent, { kind: 'run.accepted' }> => ({
  kind: 'run.accepted',
  runId: createRunId(),
  sequence: createEventSeq(1),
  at: new Date().toISOString(),
  question: 'What evidence exists?',
  agentCount: 1,
  concurrency: 1,
  profile: 'development',
})

describe('Fleet reducer', () => {
  it('accepts Vercel Workflow run IDs and their derived child IDs', () => {
    const runId = parseRunId('wrun_01JNXQEH6Z7R4D9ATK2M8CPV5B')
    const agentId = createAgentId(runId, 0)
    expect(agentId).toBe(`${runId}:agent-1`)
    expect(createToolCallId(agentId, 0)).toBe(`${agentId}:tool-1`)
  })

  it('accepts bounded conversation context for follow-up research', () => {
    const input = CreateRunInputSchema.parse({
      question: 'What changed since then?',
      context: 'Question: What is RevOps?\nAnswer: Revenue operations aligns go-to-market teams.',
      agentCount: 3,
      concurrency: 3,
      profile: 'live',
    })
    expect(input.context).toContain('Revenue operations')
  })

  it('accepts only HTTP and HTTPS research URLs', () => {
    expect(HttpUrlSchema.parse('https://example.com/research')).toBe(
      'https://example.com/research',
    )
    expect(() => HttpUrlSchema.parse('ftp://example.com/archive')).toThrow()
    expect(() => HttpUrlSchema.parse('file:///etc/passwd')).toThrow()
    expect(() => HttpUrlSchema.parse('http://127.0.0.1/private')).toThrow()
    expect(() => HttpUrlSchema.parse('http://localhost/private')).toThrow()
    expect(() => HttpUrlSchema.parse('http://localhost./private')).toThrow()
    expect(() => HttpUrlSchema.parse('http://[::1]/private')).toThrow()
    expect(() => HttpUrlSchema.parse('http://instance-data/private')).toThrow()
    expect(isPublicIpAddress('93.184.216.34')).toBe(true)
    expect(isPublicIpAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(true)
    expect(isPublicIpAddress('169.254.169.254')).toBe(false)
    expect(isPublicIpAddress('fd00::1')).toBe(false)
    expect(isPublicIpAddress('::ffff:7f00:1')).toBe(false)
    expect(isPublicIpAddress('::ffff:a00:1')).toBe(false)
    expect(isPublicIpAddress('::ffff:a9fe:a9fe')).toBe(false)
  })

  it('replays ordered events into a snapshot', () => {
    const accepted = acceptedEvent()
    const agentId = createAgentId(accepted.runId, 0)
    const events: FleetEvent[] = [
      accepted,
      {
        kind: 'agent.planned',
        runId: accepted.runId,
        sequence: createEventSeq(2),
        at: new Date().toISOString(),
        agentId,
        objective: 'Find primary sources',
      },
      {
        kind: 'agent.succeeded',
        runId: accepted.runId,
        sequence: createEventSeq(3),
        at: new Date().toISOString(),
        agentId,
        finding: 'A supported finding',
      },
    ]
    const snapshot = replayEvents(events)
    expect(snapshot?.latestSequence).toBe(3)
    expect(snapshot?.agents[0]?.finding).toBe('A supported finding')
  })

  it('ignores duplicate events and reports sequence gaps', () => {
    const accepted = acceptedEvent()
    const snapshot = replayEvents([accepted])
    expect(snapshot).not.toBeNull()
    if (!snapshot) return
    expect(reduceEvent(snapshot, accepted).kind).toBe('duplicate')
    const gap: FleetEvent = {
      kind: 'run.failed',
      runId: accepted.runId,
      sequence: createEventSeq(3),
      at: new Date().toISOString(),
      error: 'gap',
    }
    const result = reduceEvent(snapshot, gap)
    expect(result.kind).toBe('gap')
    if (result.kind === 'gap') expect(result.expected).toBe(2)
  })

  it('clears stale agent state when a durable step retries', () => {
    const accepted = acceptedEvent()
    const agentId = createAgentId(accepted.runId, 0)
    const at = new Date().toISOString()
    const snapshot = replayEvents([
      accepted,
      { kind: 'agent.planned', runId: accepted.runId, sequence: createEventSeq(2), at, agentId, objective: 'Verify claims' },
      { kind: 'agent.started', runId: accepted.runId, sequence: createEventSeq(3), at, agentId },
      { kind: 'agent.reasoning', runId: accepted.runId, sequence: createEventSeq(4), at, agentId, reasoning: 'First attempt' },
      { kind: 'agent.failed', runId: accepted.runId, sequence: createEventSeq(5), at, agentId, error: '503 overloaded' },
      { kind: 'agent.started', runId: accepted.runId, sequence: createEventSeq(6), at, agentId },
    ])
    expect(snapshot?.agents[0]).toMatchObject({
      status: 'running',
      reasoning: [],
      trace: [],
      finding: null,
      error: null,
    })
  })

  it('clears partial synthesis output when a durable synthesis step retries', () => {
    const accepted = acceptedEvent()
    const at = new Date().toISOString()
    const snapshot = replayEvents([
      accepted,
      { kind: 'synthesis.started', runId: accepted.runId, sequence: createEventSeq(2), at, synthesizer: 'test' },
      { kind: 'orchestrator.reasoning.delta', runId: accepted.runId, sequence: createEventSeq(3), at, delta: 'Old reasoning' },
      { kind: 'synthesis.delta', runId: accepted.runId, sequence: createEventSeq(4), at, delta: 'Old answer' },
      { kind: 'synthesis.started', runId: accepted.runId, sequence: createEventSeq(5), at, synthesizer: 'test' },
    ])
    expect(snapshot?.orchestratorReasoning).toBe('')
    expect(snapshot?.partialAnswer).toBe('')
  })
})
