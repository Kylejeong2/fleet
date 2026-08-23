import type { RunSnapshot } from '@fleet/client'

export type ThreadTarget = Readonly<{ channelId: 'C0BS2HGNHT8'; threadTs: string }>
export type StatusTarget = ThreadTarget & Readonly<{ statusTs: string }>

export interface SlackWebClient {
  chat: {
    postMessage(args: { channel: string; thread_ts: string; text: string }): Promise<{ ts?: string }>
    update(args: { channel: string; ts: string; text: string }): Promise<unknown>
  }
}

export interface SlackThreadPublisher {
  publishStatus(target: ThreadTarget, text: string): Promise<string>
  updateStatus(target: StatusTarget, text: string): Promise<void>
  postAnswerRemainder(target: ThreadTarget, chunks: readonly string[]): Promise<void>
}

export const createSlackThreadPublisher = (client: SlackWebClient): SlackThreadPublisher => ({
  async publishStatus(target, text) {
    const response = await client.chat.postMessage({ channel: target.channelId, thread_ts: target.threadTs, text })
    if (!response.ts) throw new Error('Slack did not return a message timestamp')
    return response.ts
  },
  async updateStatus(target, text) {
    await client.chat.update({ channel: target.channelId, ts: target.statusTs, text })
  },
  async postAnswerRemainder(target, chunks) {
    for (const text of chunks) {
      await client.chat.postMessage({ channel: target.channelId, thread_ts: target.threadTs, text })
    }
  },
})

export const renderProgress = (snapshot: RunSnapshot): string => {
  const succeeded = snapshot.agents.filter((agent) => agent.status === 'succeeded').length
  const failed = snapshot.agents.filter((agent) => agent.status === 'failed').length
  const running = snapshot.agents.filter((agent) => agent.status === 'running')
  const headline = snapshot.status === 'synthesizing'
    ? 'Fleet is synthesizing the research.'
    : `Fleet research in progress: ${succeeded + failed}/${snapshot.agentCount} agents finished.`
  const activities = running.slice(0, 3).map((agent, index) => `Agent ${index + 1}: ${agent.activity}`).join('\n')
  return activities ? `${headline}\n${activities}` : headline
}

export const splitSlackAnswer = (answer: string, limit = 2_800): readonly string[] => {
  const normalized = answer.trim() || 'Fleet completed without a written answer.'
  const chunks: string[] = []
  let current = ''
  for (const paragraph of normalized.split(/\n\n+/)) {
    if (paragraph.length > limit) {
      if (current) { chunks.push(current); current = '' }
      for (let index = 0; index < paragraph.length; index += limit) chunks.push(paragraph.slice(index, index + limit))
    } else if (!current) current = paragraph
    else if (current.length + paragraph.length + 2 <= limit) current += `\n\n${paragraph}`
    else { chunks.push(current); current = paragraph }
  }
  if (current) chunks.push(current)
  return chunks
}
