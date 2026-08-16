import { describe, expect, it } from 'vitest'
import {
  createAgentId,
  createEventSeq,
  createRunId,
  HttpUrlSchema,
  isPublicIpAddress,
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
})
