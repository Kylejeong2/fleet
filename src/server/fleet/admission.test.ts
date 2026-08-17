import { describe, expect, it, vi } from 'vitest'
import { createRunId, type CreateRunInput } from '../../lib/fleet-protocol'
import {
  AdmissionRejectedError,
  createAdmissionConfig,
  estimateTokenReservation,
  MemoryFleetPolicy,
  RedisFleetPolicy,
} from './admission'

const actor = { tenantId: 'tenant_1', userId: 'user_1' }
const input: CreateRunInput = {
  question: 'How should admission work?',
  agentCount: 3,
  concurrency: 2,
  profile: 'development',
}

describe('Fleet admission policy', () => {
  it('reserves the provider-level worst-case token envelope', () => {
    expect(estimateTokenReservation(input)).toBe(160_000)
  })

  it('passes configured capacity and budget limits to one atomic Redis script', async () => {
    const command = vi.fn().mockResolvedValue([1, 'admitted'])
    const policy = new RedisFleetPolicy(command, createAdmissionConfig({
      FLEET_MAX_GLOBAL_CONCURRENCY: '12',
      FLEET_MAX_ACTIVE_RUNS_PER_USER: '3',
      FLEET_DAILY_TOKEN_BUDGET: '900000',
      FLEET_ADMISSION_LEASE_SECONDS: '3600',
    }))

    const lease = await policy.admit(actor, input)
    const request = command.mock.calls[0]?.[0] as Array<string | number>
    expect(request[0]).toBe('EVAL')
    expect(String(request[1])).toContain('ZREMRANGEBYSCORE')
    expect(request).toContain(12)
    expect(request).toContain(900_000)
    expect(lease).toMatchObject({ actor, slots: 2, reservedTokens: 160_000 })
  })

  it('returns a retryable rejection when global capacity is full', async () => {
    const policy = new RedisFleetPolicy(
      async () => [0, 'global_capacity'],
      createAdmissionConfig(),
    )
    await expect(policy.admit(actor, input)).rejects.toMatchObject({
      reason: 'global_capacity',
      retryAfterSeconds: 10,
    } satisfies Partial<AdmissionRejectedError>)
  })

  it('deduplicates usage charges and releases active fleets idempotently', async () => {
    const policy = new MemoryFleetPolicy()
    const lease = await policy.admit(actor, input)
    const charge = {
      id: 'provider-charge-1',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.002,
      provider: 'test',
      model: 'test-model',
    }
    await policy.recordUsage(lease, createRunId(), charge)
    await policy.recordUsage(lease, createRunId(), charge)
    expect(await policy.usage(actor)).toMatchObject({
      totalTokens: 150,
      costUsd: 0.002,
      activeFleets: 1,
    })
    await policy.release(lease)
    await policy.release(lease)
    expect((await policy.usage(actor)).activeFleets).toBe(0)
  })

  it('reports the current per-user usage snapshot', async () => {
    const policy = new RedisFleetPolicy(
      async () => ['100', '40', '140', 20_000, '0.031', '1', 2],
      createAdmissionConfig(),
    )
    await expect(policy.usage(actor)).resolves.toMatchObject({
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      reservedTokens: 20_000,
      costUsd: 0.031,
      unpricedRequests: 1,
      activeFleets: 2,
    })
  })
})
