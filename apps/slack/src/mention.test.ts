import { describe, expect, it, vi } from 'vitest'
import { createMentionHandler } from './app.js'
import { parseAllowedMention } from './mention.js'

const envelope = {
  event_id: 'Ev1', team_id: 'T0BS0KMHZCM',
  event: { type: 'app_mention', channel: 'C0BS2HGNHT8', ts: '100.1', user: 'U1', text: '<@UBOT> research this' },
}

describe('Slack mention boundary', () => {
  it('accepts a tagged event and always persists a thread target', () => {
    expect(parseAllowedMention(envelope, 'UBOT')).toMatchObject({ question: 'research this', threadTs: '100.1' })
    expect(parseAllowedMention({ ...envelope, event: { ...envelope.event, thread_ts: '99.1' } }, 'UBOT')).toMatchObject({ threadTs: '99.1' })
  })

  it('returns before every effect for wrong location, bot/self, empty, and non-mention events', async () => {
    const accept = vi.fn()
    const handler = createMentionHandler('UBOT', accept)
    const invalid = [
      { ...envelope, team_id: 'TOTHER' },
      { ...envelope, event: { ...envelope.event, channel: 'COTHER' } },
      { ...envelope, event: { ...envelope.event, type: 'message' } },
      { ...envelope, event: { ...envelope.event, user: 'UBOT' } },
      { ...envelope, event: { ...envelope.event, bot_id: 'B1' } },
      { ...envelope, event: { ...envelope.event, text: '<@UBOT> ' } },
    ]
    for (const body of invalid) await handler({ body })
    expect(accept).not.toHaveBeenCalled()
  })
})
