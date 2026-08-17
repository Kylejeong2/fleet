import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  createEventSeq,
  publicRunInput,
  type CreateRunInput,
  type FleetEvent,
  parseFleetEvent,
  parseRunId,
  type RunId,
} from '../../lib/fleet-protocol'

const ExistingIdempotencySchema = z.object({
  request_hash: z.string(),
  run_id: z.string(),
})

const EventRowSchema = z.object({ event_json: z.string() })
const SequenceRowSchema = z.object({ latest: z.number() })

export type CreateRunResult =
  | { kind: 'created'; runId: RunId; event: FleetEvent }
  | { kind: 'existing'; runId: RunId }
  | { kind: 'conflict'; runId: RunId }

export class FleetJournal {
  readonly #database: DatabaseSync
  readonly #subscribers = new Map<RunId, Set<() => void>>()

  constructor(path = '.fleet/fleet.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.#database = new DatabaseSync(path)
    this.#database.exec('PRAGMA journal_mode = WAL')
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS fleet_events (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS fleet_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        run_id TEXT NOT NULL
      );
    `)
  }

  close(): void {
    this.#database.close()
  }

  createRun(args: {
    runId: RunId
    input: CreateRunInput
    idempotencyKey: string | null
  }): CreateRunResult {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(args.input))
      .digest('hex')
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      if (args.idempotencyKey) {
        const existingRaw = this.#database
          .prepare(
            'SELECT request_hash, run_id FROM fleet_idempotency WHERE idempotency_key = ?',
          )
          .get(args.idempotencyKey)
        if (existingRaw) {
          const existing = ExistingIdempotencySchema.parse(existingRaw)
          this.#database.exec('COMMIT')
          return existing.request_hash === requestHash
            ? { kind: 'existing', runId: parseRunId(existing.run_id) }
            : { kind: 'conflict', runId: parseRunId(existing.run_id) }
        }
      }
      const event: FleetEvent = {
        kind: 'run.accepted',
        runId: args.runId,
        sequence: createEventSeq(1),
        at: new Date().toISOString(),
        ...publicRunInput(args.input),
      }
      this.#database
        .prepare('INSERT INTO fleet_events (run_id, sequence, event_json) VALUES (?, ?, ?)')
        .run(args.runId, event.sequence, JSON.stringify(event))
      if (args.idempotencyKey) {
        this.#database
          .prepare(
            'INSERT INTO fleet_idempotency (idempotency_key, request_hash, run_id) VALUES (?, ?, ?)',
          )
          .run(args.idempotencyKey, requestHash, args.runId)
      }
      this.#database.exec('COMMIT')
      this.#notify(args.runId)
      return { kind: 'created', runId: args.runId, event }
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  append(
    runId: RunId,
    build: (metadata: { sequence: ReturnType<typeof createEventSeq>; at: string }) => FleetEvent,
  ): FleetEvent {
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const row = SequenceRowSchema.parse(
        this.#database
          .prepare(
            'SELECT COALESCE(MAX(sequence), 0) AS latest FROM fleet_events WHERE run_id = ?',
          )
          .get(runId),
      )
      const event = build({
        sequence: createEventSeq(row.latest + 1),
        at: new Date().toISOString(),
      })
      if (event.runId !== runId) throw new Error('Event belongs to a different run')
      this.#database
        .prepare('INSERT INTO fleet_events (run_id, sequence, event_json) VALUES (?, ?, ?)')
        .run(runId, event.sequence, JSON.stringify(event))
      this.#database.exec('COMMIT')
      this.#notify(runId)
      return event
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  read(runId: RunId, after = 0): FleetEvent[] {
    const rows = this.#database
      .prepare(
        'SELECT event_json FROM fleet_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC',
      )
      .all(runId, after)
    return z.array(EventRowSchema).parse(rows).map((row) =>
      parseFleetEvent(JSON.parse(row.event_json)),
    )
  }

  subscribe(runId: RunId, callback: () => void): () => void {
    const subscribers = this.#subscribers.get(runId) ?? new Set<() => void>()
    subscribers.add(callback)
    this.#subscribers.set(runId, subscribers)
    return () => {
      subscribers.delete(callback)
      if (subscribers.size === 0) this.#subscribers.delete(runId)
    }
  }

  #notify(runId: RunId): void {
    for (const subscriber of this.#subscribers.get(runId) ?? []) subscriber()
  }
}
