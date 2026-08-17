import { z } from 'zod'
import type { CreateRunInput, RunId } from '../../lib/fleet-protocol'
import type { FleetActor } from '../auth'
import type { RedisCommand } from './ownership'
import type { ProviderUsage } from './ports'

const AdmissionEnvironmentSchema = z.object({
  FLEET_MAX_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(32),
  FLEET_MAX_ACTIVE_RUNS_PER_USER: z.coerce.number().int().positive().default(2),
  FLEET_DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(5_000_000),
  FLEET_CREATE_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(6),
  FLEET_READ_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),
  FLEET_ADMISSION_LEASE_SECONDS: z.coerce.number().int().positive().default(86_400),
})

export type AdmissionConfig = z.infer<typeof AdmissionEnvironmentSchema>
export type RequestKind = 'create' | 'read'

export type AdmissionLease = {
  id: string
  actor: FleetActor
  slots: number
  reservedTokens: number
}

export type UsageCharge = ProviderUsage

export type UsageSnapshot = {
  period: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  reservedTokens: number
  costUsd: number
  unpricedRequests: number
  activeFleets: number
}

export class AdmissionRejectedError extends Error {
  constructor(
    readonly reason: 'rate_limit' | 'user_fleet_limit' | 'token_budget' | 'global_capacity',
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message)
  }
}

export interface FleetPolicy {
  checkRate(actor: FleetActor, kind: RequestKind): Promise<void>
  admit(actor: FleetActor, input: CreateRunInput): Promise<AdmissionLease>
  recordUsage(lease: AdmissionLease, runId: RunId, charge: UsageCharge): Promise<void>
  release(lease: AdmissionLease): Promise<void>
  usage(actor: FleetActor): Promise<UsageSnapshot>
}

export const estimateTokenReservation = (input: CreateRunInput): number =>
  input.agentCount * 48_000 + 16_000

const admitScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', ARGV[1])
local global = redis.call('ZCARD', KEYS[1])
local active = redis.call('ZCARD', KEYS[2])
local used = tonumber(redis.call('GET', KEYS[3]) or '0')
local reserved = 0
for _, member in ipairs(redis.call('ZRANGE', KEYS[4], 0, -1)) do
  reserved = reserved + tonumber(string.match(member, '|(%d+)$') or '0')
end
if global + tonumber(ARGV[3]) > tonumber(ARGV[4]) then return {0, 'global_capacity'} end
if active + 1 > tonumber(ARGV[5]) then return {0, 'user_fleet_limit'} end
if used + reserved + tonumber(ARGV[6]) > tonumber(ARGV[7]) then return {0, 'token_budget'} end
for slot = 1, tonumber(ARGV[3]) do
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[8] .. '|' .. slot)
end
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[8])
redis.call('ZADD', KEYS[4], ARGV[2], ARGV[8] .. '|' .. ARGV[6])
redis.call('EXPIRE', KEYS[3], ARGV[9])
redis.call('HSET', KEYS[5], 'slots', ARGV[3], 'reservedTokens', ARGV[6])
redis.call('EXPIRE', KEYS[5], ARGV[10])
return {1, 'admitted'}
`

const releaseScript = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local slots = tonumber(redis.call('HGET', KEYS[1], 'slots') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reservedTokens') or '0')
redis.call('DEL', KEYS[1])
for slot = 1, slots do redis.call('ZREM', KEYS[2], ARGV[1] .. '|' .. slot) end
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1] .. '|' .. reserved)
return 1
`

const usageSnapshotScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[7], '-inf', ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[8], '-inf', ARGV[1])
local reserved = 0
for _, member in ipairs(redis.call('ZRANGE', KEYS[8], 0, -1)) do
  reserved = reserved + tonumber(string.match(member, '|(%d+)$') or '0')
end
return {
  redis.call('GET', KEYS[1]), redis.call('GET', KEYS[2]),
  redis.call('GET', KEYS[3]), reserved, redis.call('GET', KEYS[4]),
  redis.call('GET', KEYS[5]), redis.call('ZCARD', KEYS[7])
}
`

const usageScript = `
if redis.call('SET', KEYS[8], '1', 'NX', 'EX', ARGV[8]) == false then return 0 end
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HINCRBY', KEYS[1], 'inputTokens', ARGV[1])
redis.call('HINCRBY', KEYS[1], 'outputTokens', ARGV[2])
redis.call('HINCRBYFLOAT', KEYS[1], 'costUsd', ARGV[3])
redis.call('HINCRBY', KEYS[1], 'unpricedRequests', ARGV[4])
redis.call('INCRBY', KEYS[2], tonumber(ARGV[1]) + tonumber(ARGV[2]))
redis.call('INCRBY', KEYS[3], ARGV[1])
redis.call('INCRBY', KEYS[4], ARGV[2])
redis.call('INCRBYFLOAT', KEYS[5], ARGV[3])
redis.call('INCRBY', KEYS[6], ARGV[4])
for index = 2, 6 do redis.call('EXPIRE', KEYS[index], ARGV[5]) end
redis.call('HINCRBY', KEYS[7], 'inputTokens', ARGV[1])
redis.call('HINCRBY', KEYS[7], 'outputTokens', ARGV[2])
redis.call('HINCRBYFLOAT', KEYS[7], 'costUsd', ARGV[3])
redis.call('HINCRBY', KEYS[7], 'unpricedRequests', ARGV[4])
redis.call('HSET', KEYS[7], 'lastProvider', ARGV[6], 'lastModel', ARGV[7])
return 1
`

const rateScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if count > tonumber(ARGV[1]) then return {0, redis.call('TTL', KEYS[1])} end
return {1, redis.call('TTL', KEYS[1])}
`

const numeric = (value: unknown): number => {
  if (value === null || value === undefined) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const utcPeriod = (): string => new Date().toISOString().slice(0, 10)
const userPrefix = (actor: FleetActor): string => `fleet:user:${actor.userId}`
const dailyKey = (actor: FleetActor, field: string): string =>
  `${userPrefix(actor)}:usage:${utcPeriod()}:${field}`
const activeKey = (actor: FleetActor): string => `${userPrefix(actor)}:active`
const reservationKey = (actor: FleetActor): string => `${userPrefix(actor)}:reservations`
const leaseKey = (leaseId: string): string => `fleet:lease:${leaseId}`

export class RedisFleetPolicy implements FleetPolicy {
  constructor(
    private readonly command: RedisCommand,
    private readonly config: AdmissionConfig,
  ) {}

  async checkRate(actor: FleetActor, kind: RequestKind): Promise<void> {
    const limit = kind === 'create'
      ? this.config.FLEET_CREATE_REQUESTS_PER_MINUTE
      : this.config.FLEET_READ_REQUESTS_PER_MINUTE
    const result = z.tuple([z.number(), z.number()]).parse(await this.command([
      'EVAL',
      rateScript,
      1,
      `${userPrefix(actor)}:rate:${kind}:${Math.floor(Date.now() / 60_000)}`,
      limit,
      60,
    ]))
    if (result[0] === 0) {
      throw new AdmissionRejectedError(
        'rate_limit',
        'Too many Fleet requests. Retry shortly.',
        Math.max(1, result[1]),
      )
    }
  }

  async admit(actor: FleetActor, input: CreateRunInput): Promise<AdmissionLease> {
    const lease: AdmissionLease = {
      id: crypto.randomUUID(),
      actor,
      slots: input.concurrency,
      reservedTokens: estimateTokenReservation(input),
    }
    const result = z.tuple([z.number(), z.string()]).parse(await this.command([
      'EVAL',
      admitScript,
      5,
      'fleet:global:active-slots',
      activeKey(actor),
      dailyKey(actor, 'tokens'),
      reservationKey(actor),
      leaseKey(lease.id),
      Date.now(),
      Date.now() + this.config.FLEET_ADMISSION_LEASE_SECONDS * 1_000,
      lease.slots,
      this.config.FLEET_MAX_GLOBAL_CONCURRENCY,
      this.config.FLEET_MAX_ACTIVE_RUNS_PER_USER,
      lease.reservedTokens,
      this.config.FLEET_DAILY_TOKEN_BUDGET,
      lease.id,
      172_800,
      this.config.FLEET_ADMISSION_LEASE_SECONDS,
    ]))
    if (result[0] === 0) throw rejection(result[1])
    return lease
  }

  async recordUsage(
    lease: AdmissionLease,
    runId: RunId,
    charge: UsageCharge,
  ): Promise<void> {
    const cost = charge.costUsd ?? 0
    await this.command([
      'EVAL',
      usageScript,
      8,
      leaseKey(lease.id),
      dailyKey(lease.actor, 'tokens'),
      dailyKey(lease.actor, 'input'),
      dailyKey(lease.actor, 'output'),
      dailyKey(lease.actor, 'cost'),
      dailyKey(lease.actor, 'unpriced'),
      `fleet:run:${runId}:usage`,
      `fleet:usage-charge:${charge.id}`,
      charge.inputTokens,
      charge.outputTokens,
      cost,
      charge.costUsd === null ? 1 : 0,
      172_800,
      charge.provider,
      charge.model,
      2_592_000,
    ])
  }

  async release(lease: AdmissionLease): Promise<void> {
    await this.command([
      'EVAL',
      releaseScript,
      4,
      leaseKey(lease.id),
      'fleet:global:active-slots',
      activeKey(lease.actor),
      reservationKey(lease.actor),
      lease.id,
    ])
  }

  async usage(actor: FleetActor): Promise<UsageSnapshot> {
    const raw = z.array(z.unknown()).length(7).parse(await this.command([
      'EVAL',
      usageSnapshotScript,
      8,
      dailyKey(actor, 'input'),
      dailyKey(actor, 'output'),
      dailyKey(actor, 'tokens'),
      dailyKey(actor, 'cost'),
      dailyKey(actor, 'unpriced'),
      'fleet:global:active-slots',
      activeKey(actor),
      reservationKey(actor),
      Date.now(),
    ]))
    return {
      period: utcPeriod(),
      inputTokens: numeric(raw[0]),
      outputTokens: numeric(raw[1]),
      totalTokens: numeric(raw[2]),
      reservedTokens: numeric(raw[3]),
      costUsd: numeric(raw[4]),
      unpricedRequests: numeric(raw[5]),
      activeFleets: numeric(raw[6]),
    }
  }
}

export const createAdmissionConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): AdmissionConfig => AdmissionEnvironmentSchema.parse(environment)

const rejection = (reason: string): AdmissionRejectedError => {
  if (reason === 'global_capacity') {
    return new AdmissionRejectedError(reason, 'Fleet is at global capacity.', 10)
  }
  if (reason === 'user_fleet_limit') {
    return new AdmissionRejectedError(reason, 'Your active fleet limit has been reached.', 10)
  }
  return new AdmissionRejectedError(
    'token_budget',
    'Your daily Fleet token budget has been reached.',
    3_600,
  )
}

export class MemoryFleetPolicy implements FleetPolicy {
  readonly #active = new Map<string, number>()
  readonly #leases = new Set<string>()
  readonly #usage = new Map<string, UsageSnapshot>()
  readonly #charges = new Set<string>()

  async checkRate(): Promise<void> {}

  async admit(actor: FleetActor, input: CreateRunInput): Promise<AdmissionLease> {
    const lease = {
      id: crypto.randomUUID(),
      actor,
      slots: input.concurrency,
      reservedTokens: estimateTokenReservation(input),
    }
    this.#leases.add(lease.id)
    this.#active.set(actor.userId, (this.#active.get(actor.userId) ?? 0) + 1)
    return lease
  }

  async recordUsage(
    lease: AdmissionLease,
    _runId: RunId,
    charge: UsageCharge,
  ): Promise<void> {
    if (!this.#leases.has(lease.id) || this.#charges.has(charge.id)) return
    this.#charges.add(charge.id)
    const current = await this.usage(lease.actor)
    const total = charge.inputTokens + charge.outputTokens
    this.#usage.set(lease.actor.userId, {
      ...current,
      inputTokens: current.inputTokens + charge.inputTokens,
      outputTokens: current.outputTokens + charge.outputTokens,
      totalTokens: current.totalTokens + total,
      costUsd: current.costUsd + (charge.costUsd ?? 0),
      unpricedRequests: current.unpricedRequests + (charge.costUsd === null ? 1 : 0),
    })
  }

  async release(lease: AdmissionLease): Promise<void> {
    if (!this.#leases.delete(lease.id)) return
    this.#active.set(lease.actor.userId, Math.max(0, (this.#active.get(lease.actor.userId) ?? 0) - 1))
  }

  async usage(actor: FleetActor): Promise<UsageSnapshot> {
    const current = this.#usage.get(actor.userId) ?? {
      period: utcPeriod(),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reservedTokens: 0,
      costUsd: 0,
      unpricedRequests: 0,
      activeFleets: this.#active.get(actor.userId) ?? 0,
    }
    return {
      ...current,
      activeFleets: this.#active.get(actor.userId) ?? 0,
    }
  }
}
