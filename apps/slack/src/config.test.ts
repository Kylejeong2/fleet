import { describe, expect, it } from 'vitest'
import { SlackFleetConfigSchema } from './config.js'

const valid = {
  SLACK_TEAM_ID: 'T0BS0KMHZCM', SLACK_CHANNEL_ID: 'C0BS2HGNHT8', SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test', FLEET_API_URL: 'http://fleet.test', FLEET_SLACK_SERVICE_TOKEN: 'secret',
  FLEET_SLACK_DB_PATH: ':memory:', FLEET_SLACK_PROFILE: 'development',
  FLEET_SLACK_AGENT_COUNT: '3', FLEET_SLACK_CONCURRENCY: '3',
}

describe('SlackFleetConfig', () => {
  it('accepts only the approved location and bounded execution', () => {
    expect(SlackFleetConfigSchema.parse(valid).FLEET_SLACK_AGENT_COUNT).toBe(3)
    for (const invalid of [
      { ...valid, SLACK_TEAM_ID: 'TOTHER' }, { ...valid, SLACK_CHANNEL_ID: 'COTHER' },
      { ...valid, FLEET_SLACK_AGENT_COUNT: '4' }, { ...valid, FLEET_SLACK_CONCURRENCY: '4' },
      { ...valid, FLEET_SLACK_AGENT_COUNT: '1', FLEET_SLACK_CONCURRENCY: '2' },
    ]) expect(SlackFleetConfigSchema.safeParse(invalid).success).toBe(false)
  })
})
