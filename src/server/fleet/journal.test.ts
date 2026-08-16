import { describe, expect, it } from 'vitest'
import { createRunId, type CreateRunInput } from '../../lib/fleet-protocol'
import { FleetJournal } from './journal'

const input: CreateRunInput = {
  question: 'What evidence exists?',
  agentCount: 3,
  concurrency: 2,
  profile: 'development',
}

describe('FleetJournal', () => {
  it('returns the first run for an identical idempotent request', () => {
    const journal = new FleetJournal(':memory:')
    const first = journal.createRun({ runId: createRunId(), input, idempotencyKey: 'same' })
    const second = journal.createRun({ runId: createRunId(), input, idempotencyKey: 'same' })
    expect(first.kind).toBe('created')
    expect(second.kind).toBe('existing')
    expect(second.runId).toBe(first.runId)
    expect(journal.read(first.runId)).toHaveLength(1)
    journal.close()
  })

  it('detects reuse of a key with a different request', () => {
    const journal = new FleetJournal(':memory:')
    journal.createRun({ runId: createRunId(), input, idempotencyKey: 'conflict' })
    const result = journal.createRun({
      runId: createRunId(),
      input: { ...input, agentCount: 4 },
      idempotencyKey: 'conflict',
    })
    expect(result.kind).toBe('conflict')
    journal.close()
  })

  it('assigns atomic run-local sequences', () => {
    const journal = new FleetJournal(':memory:')
    const runId = createRunId()
    journal.createRun({ runId, input, idempotencyKey: null })
    const second = journal.append(runId, (metadata) => ({
      kind: 'run.failed',
      runId,
      ...metadata,
      error: 'test',
    }))
    expect(second.sequence).toBe(2)
    journal.close()
  })
})
