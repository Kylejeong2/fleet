import { describe, expect, it } from 'vitest'
import { createRunId, type CreateRunInput } from '../../lib/fleet-protocol'
import { FleetJournal } from './journal'
import { FleetService, RunNotFoundError } from './service'

const input: CreateRunInput = {
  question: 'Who can read this run?',
  agentCount: 1,
  concurrency: 1,
  profile: 'development',
}

describe('FleetService ownership', () => {
  it('returns the same not-found error for unknown and foreign runs', () => {
    const journal = new FleetJournal(':memory:')
    const runId = createRunId()
    const owner = { tenantId: 'tenant_1', userId: 'user_1' }
    journal.createRun({ runId, input, idempotencyKey: null, actor: owner })
    const service = new FleetService(journal, () => {
      throw new Error('Coordinator is not used by this test')
    })

    expect(service.getRun(owner, runId).id).toBe(runId)
    expect(() => service.getRun(
      { tenantId: 'tenant_2', userId: 'user_2' },
      runId,
    )).toThrowError(RunNotFoundError)
    expect(() => service.getRun(owner, createRunId())).toThrowError(RunNotFoundError)
    journal.close()
  })
})
