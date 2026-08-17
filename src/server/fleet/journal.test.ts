import { describe, expect, it } from 'vitest'
import { createRunId, type CreateRunInput } from '../../lib/fleet-protocol'
import { FleetJournal } from './journal'

const input: CreateRunInput = {
  question: 'What evidence exists?',
  agentCount: 3,
  concurrency: 2,
  profile: 'development',
}
const actor = { tenantId: 'tenant_1', userId: 'user_1' }

describe('FleetJournal', () => {
  it('returns the first run for an identical idempotent request', () => {
    const journal = new FleetJournal(':memory:')
    const first = journal.createRun({ runId: createRunId(), input, idempotencyKey: 'same', actor })
    const second = journal.createRun({ runId: createRunId(), input, idempotencyKey: 'same', actor })
    expect(first.kind).toBe('created')
    expect(second.kind).toBe('existing')
    expect(second.runId).toBe(first.runId)
    expect(journal.read(first.runId)).toHaveLength(1)
    journal.close()
  })

  it('detects reuse of a key with a different request', () => {
    const journal = new FleetJournal(':memory:')
    journal.createRun({ runId: createRunId(), input, idempotencyKey: 'conflict', actor })
    const result = journal.createRun({
      runId: createRunId(),
      input: { ...input, agentCount: 4 },
      idempotencyKey: 'conflict',
      actor,
    })
    expect(result.kind).toBe('conflict')
    journal.close()
  })

  it('assigns atomic run-local sequences', () => {
    const journal = new FleetJournal(':memory:')
    const runId = createRunId()
    journal.createRun({ runId, input, idempotencyKey: null, actor })
    const second = journal.append(runId, (metadata) => ({
      kind: 'run.failed',
      runId,
      ...metadata,
      error: 'test',
    }))
    expect(second.sequence).toBe(2)
    journal.close()
  })

  it('scopes idempotency and run access to the tenant', () => {
    const journal = new FleetJournal(':memory:')
    const first = journal.createRun({ runId: createRunId(), input, idempotencyKey: 'same', actor })
    const other = journal.createRun({
      runId: createRunId(),
      input,
      idempotencyKey: 'same',
      actor: { tenantId: 'tenant_2', userId: 'user_2' },
    })
    expect(first.kind).toBe('created')
    expect(other.kind).toBe('created')
    expect(journal.ownsRun(first.runId, 'tenant_1')).toBe(true)
    expect(journal.ownsRun(first.runId, 'tenant_2')).toBe(false)
    journal.close()
  })

  it('removes expired ownership, events, and idempotency together', () => {
    const journal = new FleetJournal(':memory:')
    const result = journal.createRun({
      runId: createRunId(),
      input,
      idempotencyKey: 'expired',
      actor,
    })
    expect(journal.cleanupExpired(new Date(Date.now() + 1_000))).toBe(1)
    expect(journal.read(result.runId)).toEqual([])
    expect(journal.ownsRun(result.runId, actor.tenantId)).toBe(false)
    journal.close()
  })
})
