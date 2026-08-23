import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunIdSchema } from '@fleet/client'
import { DeliveryStore } from './delivery-store.js'
import type { SlackMention } from './mention.js'

const mention: SlackMention = {
  key: 'T0BS0KMHZCM:Ev1', eventId: 'Ev1', teamId: 'T0BS0KMHZCM', channelId: 'C0BS2HGNHT8',
  eventTs: '100.1', threadTs: '100.1', authorId: 'U1', question: 'research this',
}
const runId = RunIdSchema.parse('123e4567-e89b-42d3-a456-426614174000')

describe('DeliveryStore state machine', () => {
  it('deduplicates acceptance and persists monotonic terminal transitions', () => {
    const store = new DeliveryStore(':memory:')
    expect(store.accept(mention).phase).toBe('queued')
    expect(store.accept(mention).phase).toBe('queued')
    store.following(mention.key, runId)
    store.statusPublished(mention.key, '101.1')
    store.advance(mention.key, 2)
    expect(() => store.advance(mention.key, 1)).toThrow()
    store.terminalPending(mention.key, 3, 'answer')
    expect(store.get(mention.key)).toMatchObject({ phase: 'terminal-pending', runId, cursor: 3, mention: { threadTs: '100.1' } })
    store.delivered(mention.key)
    expect(store.get(mention.key).phase).toBe('delivered')
    store.close()
  })

  it('reopens queued, following, and terminal-pending recovery states', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fleet-slack-store-'))
    const path = join(directory, 'delivery.sqlite')
    let store = new DeliveryStore(path)
    store.accept(mention)
    store.close()
    store = new DeliveryStore(path)
    expect(store.get(mention.key).phase).toBe('queued')
    store.following(mention.key, runId)
    store.close()
    store = new DeliveryStore(path)
    expect(store.get(mention.key)).toMatchObject({ phase: 'following', runId })
    store.statusPublished(mention.key, '101.1')
    store.terminalPending(mention.key, 2, 'answer')
    store.close()
    store = new DeliveryStore(path)
    expect(store.get(mention.key)).toMatchObject({ phase: 'terminal-pending', runId, terminalText: 'answer' })
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })
})
