import { z } from 'zod'
import { parseRunId } from '../../lib/fleet-protocol'
import type { RedisCommand } from './ownership'
import { ownershipKey } from './ownership'

const RetentionEnvironmentSchema = z.object({
  FLEET_RUN_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
})

export type RetentionConfig = z.infer<typeof RetentionEnvironmentSchema>

export const createRetentionConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): RetentionConfig => RetentionEnvironmentSchema.parse(environment)

export const retentionSeconds = (config: RetentionConfig): number =>
  config.FLEET_RUN_RETENTION_DAYS * 24 * 60 * 60

export const cleanupExpiredRedisRuns = async (
  command: RedisCommand,
  now = Date.now(),
  batchSize = 1_000,
): Promise<number> => {
  const raw = await command([
    'ZRANGEBYSCORE',
    'fleet:runs:expires',
    '-inf',
    now,
    'LIMIT',
    0,
    batchSize,
  ])
  const runIds = z.array(z.string()).parse(raw).map(parseRunId)
  for (const runId of runIds) {
    await command(['DEL', ownershipKey(runId), `fleet:run:${runId}:usage`])
    await command(['ZREM', 'fleet:runs:expires', runId])
  }
  return runIds.length
}
