import { App } from '@slack/bolt'
import { createFleetClient } from '@fleet/client'
import type { SlackFleetConfig } from './config.js'
import { DeliveryService } from './delivery.js'
import { DeliveryStore } from './delivery-store.js'
import { parseAllowedMention, type SlackMention } from './mention.js'
import { createSlackThreadPublisher } from './slack-thread.js'
import { createSlackContextReader } from './thread-context.js'

export const createMentionHandler = (
  botUserId: string,
  accept: (mention: SlackMention) => void,
) => async ({ body }: { body: unknown }) => {
  const mention = parseAllowedMention(body, botUserId)
  if (mention) accept(mention)
}

export const createSlackFleetApp = (config: SlackFleetConfig) => {
  const bolt = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    socketMode: true,
  })
  const store = new DeliveryStore(config.FLEET_SLACK_DB_PATH)
  const fleet = createFleetClient({
    baseUrl: config.FLEET_API_URL,
    authorization: { kind: 'bearer', token: config.FLEET_SLACK_SERVICE_TOKEN },
  })
  const delivery = new DeliveryService(
    store,
    fleet,
    createSlackThreadPublisher(bolt.client),
    createSlackContextReader(bolt.client),
    {
      profile: config.FLEET_SLACK_PROFILE,
      agentCount: config.FLEET_SLACK_AGENT_COUNT,
      concurrency: config.FLEET_SLACK_CONCURRENCY,
    },
  )
  let botUserId = ''
  bolt.event('app_mention', async ({ body }) => {
    if (!botUserId) return
    await createMentionHandler(botUserId, (mention) => delivery.accept(mention))({ body })
  })
  return {
    async start() {
      const identity = await bolt.client.auth.test()
      if (!identity.user_id || identity.team_id !== config.SLACK_TEAM_ID) {
        throw new Error('Slack token does not belong to the configured team')
      }
      botUserId = identity.user_id
      await bolt.start()
      delivery.wake()
    },
    async stop() {
      await delivery.idle()
      await bolt.stop()
      store.close()
    },
  }
}
