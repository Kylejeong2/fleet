import { describe, expect, it, vi } from 'vitest'
import { parseRunId } from '../../lib/fleet-protocol'
import { RedisRunOwnershipStore } from './ownership'

const runId = parseRunId('wrun_01JNXQEH6Z7R4D9ATK2M8CPV5B')

describe('Redis run ownership', () => {
  it('records tenant and creator metadata', async () => {
    const command = vi.fn().mockResolvedValue(3)
    await new RedisRunOwnershipStore(command).put(runId, {
      tenantId: 'org_1',
      userId: 'user_1',
    })
    expect(command).toHaveBeenCalledWith([
      'HSET',
      `fleet:run:${runId}`,
      'tenantId',
      'org_1',
      'userId',
      'user_1',
      'createdAt',
      expect.any(String),
    ])
  })

  it('matches only the owning tenant', async () => {
    const store = new RedisRunOwnershipStore(async () => 'org_1')
    await expect(store.owns(runId, 'org_1')).resolves.toBe(true)
    await expect(store.owns(runId, 'org_2')).resolves.toBe(false)
  })
})
