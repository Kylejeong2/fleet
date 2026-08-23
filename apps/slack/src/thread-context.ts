import type { SlackMention } from './mention.js'

type SlackMessage = Readonly<{
  ts?: string
  text?: string
  user?: string
  bot_id?: string
}>

export interface SlackConversationClient {
  conversations: {
    history(args: {
      channel: 'C0BS2HGNHT8'
      latest: string
      inclusive: true
      limit: 15
    }): Promise<{ messages?: SlackMessage[] }>
    replies(args: {
      channel: 'C0BS2HGNHT8'
      ts: string
      latest: string
      inclusive: true
      limit: 15
    }): Promise<{ messages?: SlackMessage[] }>
  }
}

export interface SlackContextReader {
  read(mention: SlackMention): Promise<string>
}

const renderMessages = (messages: readonly SlackMessage[], eventTs: string) => messages
  .filter((message) => message.ts !== eventTs && message.text?.trim())
  .slice()
  .sort((left, right) => Number(left.ts ?? 0) - Number(right.ts ?? 0))
  .map((message) => `${message.user ? `<@${message.user}>` : 'Fleet'}: ${message.text!.trim()}`)
  .join('\n')
  .slice(-12_000)

export const createSlackContextReader = (client: SlackConversationClient): SlackContextReader => ({
  async read(mention) {
    const response = mention.threadTs === mention.eventTs
      ? await client.conversations.history({
        channel: mention.channelId,
        latest: mention.eventTs,
        inclusive: true,
        limit: 15,
      })
      : await client.conversations.replies({
        channel: mention.channelId,
        ts: mention.threadTs,
        latest: mention.eventTs,
        inclusive: true,
        limit: 15,
      })
    return renderMessages(response.messages ?? [], mention.eventTs)
  },
})

export const questionWithSlackContext = (mention: SlackMention, context: string) => context
  ? `Slack conversation context:\n${context}\n\nCurrent request from <@${mention.authorId}>:\n${mention.question}`
  : mention.question
