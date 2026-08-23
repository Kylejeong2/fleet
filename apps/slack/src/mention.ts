import { z } from 'zod'

const EnvelopeSchema = z.object({
  event_id: z.string().min(1),
  team_id: z.string(),
  event: z.object({
    type: z.string(),
    channel: z.string(),
    ts: z.string().min(1),
    thread_ts: z.string().min(1).optional(),
    user: z.string().min(1).optional(),
    text: z.string(),
    bot_id: z.string().optional(),
    subtype: z.string().optional(),
  }),
})

export type SlackMention = Readonly<{
  key: string
  eventId: string
  teamId: 'T0BS0KMHZCM'
  channelId: 'C0BS2HGNHT8'
  eventTs: string
  threadTs: string
  authorId: string
  question: string
}>

export const parseAllowedMention = (envelope: unknown, botUserId: string): SlackMention | null => {
  const parsed = EnvelopeSchema.safeParse(envelope)
  if (!parsed.success) return null
  const { event, event_id: eventId, team_id: teamId } = parsed.data
  if (
    event.type !== 'app_mention' ||
    teamId !== 'T0BS0KMHZCM' ||
    event.channel !== 'C0BS2HGNHT8' ||
    !event.user ||
    event.user === botUserId ||
    event.bot_id ||
    event.subtype
  ) return null
  const question = event.text.replace(new RegExp(`^\\s*<@${botUserId}>\\s*`), '').trim()
  if (question.length < 3) return null
  return {
    key: `${teamId}:${eventId}`,
    eventId,
    teamId,
    channelId: event.channel,
    eventTs: event.ts,
    threadTs: event.thread_ts ?? event.ts,
    authorId: event.user,
    question,
  }
}

export const fleetIdempotencyKey = (mention: Pick<SlackMention, 'teamId' | 'eventId'>) =>
  `slack:v1:${mention.teamId}:${mention.eventId}`
