import { describe, expect, it, vi } from 'vitest'
import type { SlackMention } from './mention.js'
import { createSlackContextReader, questionWithSlackContext } from './thread-context.js'

const mention: SlackMention = {
  key: 'T0BS0KMHZCM:Ev1', eventId: 'Ev1', teamId: 'T0BS0KMHZCM', channelId: 'C0BS2HGNHT8',
  eventTs: '100.1', threadTs: '100.1', authorId: 'U1', question: 'compare these options',
}

describe('Slack context reader', () => {
  it('reads only recent messages from the approved channel for a top-level mention', async () => {
    const history = vi.fn(async () => ({ messages: [
      { ts: '100.1', user: 'U1', text: '<@UBOT> compare these options' },
      { ts: '99.1', user: 'U2', text: 'Option B costs less.' },
      { ts: '98.1', bot_id: 'B1', text: 'Option A ships sooner.' },
    ] }))
    const replies = vi.fn()
    const reader = createSlackContextReader({ conversations: { history, replies } })
    const context = await reader.read(mention)
    expect(history).toHaveBeenCalledWith({ channel: 'C0BS2HGNHT8', latest: '100.1', inclusive: true, limit: 15 })
    expect(replies).not.toHaveBeenCalled()
    expect(context).toBe('Fleet: Option A ships sooner.\n<@U2>: Option B costs less.')
    expect(questionWithSlackContext(mention, context)).toContain('Current request from <@U1>:\ncompare these options')
  })

  it('reads the originating thread for a threaded mention', async () => {
    const history = vi.fn()
    const replies = vi.fn(async () => ({ messages: [{ ts: '90.1', user: 'U2', text: 'Use the Q2 figures.' }] }))
    const reader = createSlackContextReader({ conversations: { history, replies } })
    await reader.read({ ...mention, threadTs: '90.1' })
    expect(replies).toHaveBeenCalledWith({ channel: 'C0BS2HGNHT8', ts: '90.1', latest: '100.1', inclusive: true, limit: 15 })
    expect(history).not.toHaveBeenCalled()
  })
})
