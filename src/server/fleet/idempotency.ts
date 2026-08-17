import { createHash } from 'node:crypto'
import { z } from 'zod'
import { parseRunId, type CreateRunInput, type RunId } from '../../lib/fleet-protocol'
import { createRetentionConfig, retentionSeconds } from './retention'

const StoredReservationSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending'), requestHash: z.string(), token: z.string() }),
  z.object({ state: z.literal('committed'), requestHash: z.string(), runId: z.string() }),
])

const RedisResponseSchema = z.object({ result: z.unknown() })
const DEFAULT_RESERVATION_TTL_SECONDS = 60 * 60 * 24 * 30

export type ReservationResult =
  | { kind: 'reserved'; token: string; requestHash: string }
  | { kind: 'existing'; runId: RunId }
  | { kind: 'pending' }
  | { kind: 'conflict' }

export interface IdempotencyStore {
  reserve(tenantId: string, key: string, input: CreateRunInput): Promise<ReservationResult>
  commit(
    tenantId: string,
    key: string,
    token: string,
    requestHash: string,
    runId: RunId,
  ): Promise<void>
  release(tenantId: string, key: string, token: string, requestHash: string): Promise<void>
}

type RedisCommand = (command: Array<string | number>) => Promise<unknown>

const reserveScript = `
local existing = redis.call('GET', KEYS[1])
if existing then return {0, existing} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return {1, ARGV[1]}
`

const commitScript = `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`

const releaseScript = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly command: RedisCommand,
    private readonly ttlSeconds = DEFAULT_RESERVATION_TTL_SECONDS,
  ) {}

  async reserve(
    tenantId: string,
    key: string,
    input: CreateRunInput,
  ): Promise<ReservationResult> {
    const requestHash = hashInput(input)
    const token = crypto.randomUUID()
    const pending = JSON.stringify({ state: 'pending', requestHash, token })
    const raw = await this.command([
      'EVAL',
      reserveScript,
      1,
      redisKey(tenantId, key),
      pending,
      this.ttlSeconds,
    ])
    const result = z.tuple([z.number(), z.string()]).parse(raw)
    if (result[0] === 1) return { kind: 'reserved', token, requestHash }
    const existing = StoredReservationSchema.parse(JSON.parse(result[1]))
    if (existing.requestHash !== requestHash) return { kind: 'conflict' }
    if (existing.state === 'pending') return { kind: 'pending' }
    return { kind: 'existing', runId: parseRunId(existing.runId) }
  }

  async commit(
    tenantId: string,
    key: string,
    token: string,
    requestHash: string,
    runId: RunId,
  ): Promise<void> {
    const pending = JSON.stringify({ state: 'pending', requestHash, token })
    const committed = JSON.stringify({ state: 'committed', requestHash, runId })
    const result = await this.command([
      'EVAL',
      commitScript,
      1,
      redisKey(tenantId, key),
      pending,
      committed,
      this.ttlSeconds,
    ])
    if (z.number().parse(result) !== 1) {
      throw new Error('Could not commit the workflow idempotency reservation.')
    }
  }

  async release(
    tenantId: string,
    key: string,
    token: string,
    requestHash: string,
  ): Promise<void> {
    await this.command([
      'EVAL',
      releaseScript,
      1,
      redisKey(tenantId, key),
      JSON.stringify({ state: 'pending', requestHash, token }),
    ])
  }
}

export const createRedisIdempotencyStore = (environment: NodeJS.ProcessEnv): IdempotencyStore => {
  const url = environment.KV_REST_API_URL ?? environment.UPSTASH_REDIS_REST_URL
  const token = environment.KV_REST_API_TOKEN ?? environment.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error(
      'Workflow mode requires KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST equivalents).',
    )
  }
  const ttlSeconds = retentionSeconds(createRetentionConfig(environment))
  return new RedisIdempotencyStore(async (command) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
    })
    if (!response.ok) throw new Error(`Idempotency store returned ${response.status}.`)
    return RedisResponseSchema.parse(await response.json()).result
  }, ttlSeconds)
}

const redisKey = (tenantId: string, key: string): string =>
  `fleet:idempotency:${createHash('sha256').update(tenantId).digest('hex').slice(0, 24)}:${key}`

const hashInput = (input: CreateRunInput): string =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex')
