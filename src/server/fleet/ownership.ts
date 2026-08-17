import { z } from 'zod'
import type { RunId } from '../../lib/fleet-protocol'
import type { FleetActor } from '../auth'

const RedisResponseSchema = z.object({ result: z.unknown() })

export interface RunOwnershipStore {
  put(runId: RunId, actor: FleetActor, leaseId?: string): Promise<void>
  owns(runId: RunId, tenantId: string): Promise<boolean>
}

export type RedisCommand = (command: Array<string | number>) => Promise<unknown>

export class RedisRunOwnershipStore implements RunOwnershipStore {
  constructor(private readonly command: RedisCommand) {}

  async put(runId: RunId, actor: FleetActor, leaseId?: string): Promise<void> {
    await this.command([
      'HSET',
      ownershipKey(runId),
      'tenantId',
      actor.tenantId,
      'userId',
      actor.userId,
      'createdAt',
      new Date().toISOString(),
      ...(leaseId ? ['leaseId', leaseId] : []),
    ])
  }

  async owns(runId: RunId, tenantId: string): Promise<boolean> {
    return z.string().nullable().parse(
      await this.command(['HGET', ownershipKey(runId), 'tenantId']),
    ) === tenantId
  }
}

export const createRedisCommand = (environment: NodeJS.ProcessEnv): RedisCommand => {
  const url = environment.KV_REST_API_URL ?? environment.UPSTASH_REDIS_REST_URL
  const token = environment.KV_REST_API_TOKEN ?? environment.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      'Workflow mode requires KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST equivalents).',
    )
  }
  return async (command) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
    })
    if (!response.ok) throw new Error(`Fleet state store returned ${response.status}.`)
    return RedisResponseSchema.parse(await response.json()).result
  }
}

export const ownershipKey = (runId: RunId): string => `fleet:run:${runId}`
