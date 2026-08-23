import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { RunIdSchema, type RunId } from '@fleet/client'
import type { SlackMention } from './mention.js'

type DeliveryBase = Readonly<{
  key: string
  mention: SlackMention
  cursor: number
  statusTs: string | null
}>
export type Delivery =
  | (DeliveryBase & { phase: 'queued'; runId: null })
  | (DeliveryBase & { phase: 'following'; runId: RunId })
  | (DeliveryBase & { phase: 'terminal-pending'; runId: RunId; statusTs: string; terminalText: string })
  | (DeliveryBase & { phase: 'delivered'; runId: RunId; statusTs: string })
  | (DeliveryBase & { phase: 'failed'; runId: RunId | null; publicError: string })

const RowSchema = z.object({
  event_key: z.string(), event_id: z.string(), team_id: z.literal('T0BS0KMHZCM'),
  channel_id: z.literal('C0BS2HGNHT8'), event_ts: z.string(), thread_ts: z.string(),
  author_id: z.string(), question: z.string(), phase: z.enum(['queued', 'following', 'terminal-pending', 'delivered', 'failed']),
  run_id: z.string().nullable(), cursor: z.number().int().nonnegative(), status_ts: z.string().nullable(),
  terminal_text: z.string().nullable(), public_error: z.string().nullable(),
})

const parseRow = (input: unknown): Delivery => {
  const row = RowSchema.parse(input)
  const mention: SlackMention = {
    key: row.event_key, eventId: row.event_id, teamId: row.team_id, channelId: row.channel_id,
    eventTs: row.event_ts, threadTs: row.thread_ts, authorId: row.author_id, question: row.question,
  }
  const base = { key: row.event_key, mention, cursor: row.cursor, statusTs: row.status_ts }
  if (row.phase === 'queued') {
    if (row.run_id !== null) throw new Error('Invalid queued delivery row')
    return { ...base, phase: 'queued', runId: null }
  }
  if (row.phase === 'following') {
    return { ...base, phase: 'following', runId: RunIdSchema.parse(row.run_id) }
  }
  if (row.phase === 'terminal-pending') {
    if (!row.status_ts || row.terminal_text === null) throw new Error('Invalid terminal-pending delivery row')
    return { ...base, phase: 'terminal-pending', runId: RunIdSchema.parse(row.run_id), statusTs: row.status_ts, terminalText: row.terminal_text }
  }
  if (row.phase === 'delivered') {
    if (!row.status_ts) throw new Error('Invalid delivered delivery row')
    return { ...base, phase: 'delivered', runId: RunIdSchema.parse(row.run_id), statusTs: row.status_ts }
  }
  if (row.public_error === null) throw new Error('Invalid failed delivery row')
  return { ...base, phase: 'failed', runId: row.run_id === null ? null : RunIdSchema.parse(row.run_id), publicError: row.public_error }
}

export class DeliveryStore {
  private readonly database: DatabaseSync
  constructor(path: string) {
    this.database = new DatabaseSync(path)
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;')
    this.database.exec(`CREATE TABLE IF NOT EXISTS deliveries (
      event_key TEXT PRIMARY KEY, event_id TEXT NOT NULL, team_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      event_ts TEXT NOT NULL, thread_ts TEXT NOT NULL, author_id TEXT NOT NULL, question TEXT NOT NULL,
      phase TEXT NOT NULL, run_id TEXT, cursor INTEGER NOT NULL DEFAULT 0, status_ts TEXT,
      terminal_text TEXT, public_error TEXT,
      CHECK (phase IN ('queued','following','terminal-pending','delivered','failed'))
    )`)
  }
  close() { this.database.close() }
  accept(mention: SlackMention): Delivery {
    this.database.prepare(`INSERT OR IGNORE INTO deliveries
      (event_key,event_id,team_id,channel_id,event_ts,thread_ts,author_id,question,phase)
      VALUES (?,?,?,?,?,?,?,?, 'queued')`).run(
      mention.key, mention.eventId, mention.teamId, mention.channelId, mention.eventTs,
      mention.threadTs, mention.authorId, mention.question,
    )
    return this.get(mention.key)
  }
  get(key: string): Delivery {
    const row = this.database.prepare('SELECT * FROM deliveries WHERE event_key = ?').get(key)
    if (!row) throw new Error(`Unknown delivery ${key}`)
    return parseRow(row)
  }
  pending(): Delivery[] {
    return this.database.prepare("SELECT * FROM deliveries WHERE phase NOT IN ('delivered','failed') ORDER BY rowid").all().map(parseRow)
  }
  following(key: string, runId: RunId) {
    this.database.prepare("UPDATE deliveries SET phase='following', run_id=? WHERE event_key=? AND phase='queued'").run(runId, key)
  }
  statusPublished(key: string, statusTs: string) {
    this.database.prepare("UPDATE deliveries SET status_ts=? WHERE event_key=? AND phase='following' AND status_ts IS NULL").run(statusTs, key)
  }
  advance(key: string, cursor: number) {
    const result = this.database.prepare("UPDATE deliveries SET cursor=? WHERE event_key=? AND phase='following' AND cursor<=?").run(cursor, key, cursor)
    if (result.changes !== 1) throw new Error('Cursor cannot decrease or delivery is not following')
  }
  terminalPending(key: string, cursor: number, terminalText: string) {
    const result = this.database.prepare("UPDATE deliveries SET phase='terminal-pending',cursor=?,terminal_text=? WHERE event_key=? AND phase='following' AND status_ts IS NOT NULL AND cursor<=?").run(cursor, terminalText, key, cursor)
    if (result.changes !== 1) throw new Error('Terminal delivery requires a run, status message, and monotonic cursor')
  }
  delivered(key: string) {
    const result = this.database.prepare("UPDATE deliveries SET phase='delivered',terminal_text=NULL WHERE event_key=? AND phase='terminal-pending'").run(key)
    if (result.changes !== 1) throw new Error('Only terminal-pending deliveries can be delivered')
  }
  failed(key: string, publicError: string) {
    this.database.prepare("UPDATE deliveries SET phase='failed',public_error=? WHERE event_key=? AND phase NOT IN ('delivered','failed')").run(publicError, key)
  }
}
