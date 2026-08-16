import { describe, expect, it } from 'vitest'
import { parseRunId } from '../../lib/fleet-protocol'
import { createAssignments, createBatches } from './workflow'

describe('Fleet workflow planning', () => {
  it('creates stable assignments from a Workflow run ID', () => {
    const runId = parseRunId('wrun_01JNXQEH6Z7R4D9ATK2M8CPV5B')
    const assignments = createAssignments(runId, 3)
    expect(assignments).toHaveLength(3)
    expect(assignments.map(({ agentId }) => agentId)).toEqual([
      `${runId}:agent-1`,
      `${runId}:agent-2`,
      `${runId}:agent-3`,
    ])
  })

  it('batches fan-out work at the requested concurrency', () => {
    expect(createBatches([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ])
  })
})
