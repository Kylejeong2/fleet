import { describe, expect, it, vi } from 'vitest'
import { parseRunId } from '../../lib/fleet-protocol'
import { cleanupExpiredRedisRuns, createRetentionConfig, retentionSeconds } from './retention'

const runId = parseRunId('wrun_01JNXQEH6Z7R4D9ATK2M8CPV5B')

describe('Fleet retention', () => {
  it('bounds and converts the configured retention period', () => {
    expect(retentionSeconds(createRetentionConfig({ FLEET_RUN_RETENTION_DAYS: '7' }))).toBe(604_800)
    expect(() => createRetentionConfig({ FLEET_RUN_RETENTION_DAYS: '0' })).toThrow()
    expect(() => createRetentionConfig({ FLEET_RUN_RETENTION_DAYS: '366' })).toThrow()
  })

  it('deletes expired Redis projections in bounded batches', async () => {
    const command = vi.fn()
      .mockResolvedValueOnce([runId])
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
    await expect(cleanupExpiredRedisRuns(command, 123, 10)).resolves.toBe(1)
    expect(command).toHaveBeenNthCalledWith(2, [
      'DEL',
      `fleet:run:${runId}`,
      `fleet:run:${runId}:usage`,
    ])
  })
})
