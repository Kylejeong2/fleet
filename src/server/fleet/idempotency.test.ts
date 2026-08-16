import { describe, expect, it, vi } from 'vitest'
import { parseRunId, type CreateRunInput } from '../../lib/fleet-protocol'
import { RedisIdempotencyStore } from './idempotency'

const input: CreateRunInput = {
  question: 'What makes queues durable?',
  agentCount: 3,
  concurrency: 2,
  profile: 'development',
}

describe('Redis idempotency reservations', () => {
  it('reserves a new key atomically', async () => {
    const command = vi.fn().mockImplementation(async (request: Array<string | number>) => [
      1,
      request[4],
    ])
    const store = new RedisIdempotencyStore(command)
    const reservation = await store.reserve('request-1', input)
    expect(reservation.kind).toBe('reserved')
    expect(command).toHaveBeenCalledOnce()
    expect(command.mock.calls[0]?.[0]).toContain('fleet:idempotency:request-1')
  })

  it('returns a previously committed workflow for the same request', async () => {
    const firstCommand = vi.fn().mockImplementation(async (request: Array<string | number>) => [
      1,
      request[4],
    ])
    const first = await new RedisIdempotencyStore(firstCommand).reserve('request-2', input)
    if (first.kind !== 'reserved') throw new Error('Expected a reservation')
    const runId = parseRunId('wrun_01JNXQEH6Z7R4D9ATK2M8CPV5B')
    const existing = JSON.stringify({ state: 'committed', requestHash: first.requestHash, runId })
    const store = new RedisIdempotencyStore(async () => [0, existing])
    await expect(store.reserve('request-2', input)).resolves.toEqual({
      kind: 'existing',
      runId,
    })
  })

  it('rejects a reused key with different input', async () => {
    const existing = JSON.stringify({
      state: 'pending',
      requestHash: 'different-request',
      token: crypto.randomUUID(),
    })
    const store = new RedisIdempotencyStore(async () => [0, existing])
    await expect(store.reserve('request-3', input)).resolves.toEqual({ kind: 'conflict' })
  })
})
