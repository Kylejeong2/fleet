import { z } from 'zod'

const Count = z.coerce.number().int().min(1).max(3)
export const SlackFleetConfigSchema = z.object({
  SLACK_TEAM_ID: z.literal('T0BS0KMHZCM'),
  SLACK_CHANNEL_ID: z.literal('C0BS2HGNHT8'),
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_APP_TOKEN: z.string().min(1),
  FLEET_API_URL: z.string().url().transform((value) => new URL(value)),
  FLEET_SLACK_SERVICE_TOKEN: z.string().min(1),
  FLEET_SLACK_DB_PATH: z.string().min(1),
  FLEET_SLACK_PROFILE: z.enum(['development', 'live-workers', 'live']),
  FLEET_SLACK_AGENT_COUNT: Count,
  FLEET_SLACK_CONCURRENCY: Count,
}).superRefine((value, ctx) => {
  if (value.FLEET_SLACK_CONCURRENCY > value.FLEET_SLACK_AGENT_COUNT) {
    ctx.addIssue({ code: 'custom', path: ['FLEET_SLACK_CONCURRENCY'], message: 'concurrency cannot exceed agent count' })
  }
})
export type SlackFleetConfig = z.infer<typeof SlackFleetConfigSchema>
