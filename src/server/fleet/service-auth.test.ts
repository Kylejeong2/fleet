import { describe, expect, it } from 'vitest'
import { enforceCallerPolicy, FleetAuthenticationError, FleetAuthorizationError, identifyFleetCaller } from './service-auth'

const input = { question: 'research this', agentCount: 3, concurrency: 3, profile: 'development' as const }

describe('Fleet Slack service principal', () => {
  it('preserves browser behavior when authorization is absent', () => {
    expect(identifyFleetCaller(new Request('http://fleet.test'), {})).toEqual({ kind: 'browser' })
  })

  it('accepts the configured bearer and rejects every supplied invalid bearer', () => {
    const environment = { FLEET_SLACK_SERVICE_TOKEN: 'test-service-token' }
    const valid = new Request('http://fleet.test', { headers: { authorization: 'Bearer test-service-token' } })
    expect(identifyFleetCaller(valid, environment)).toEqual({ kind: 'service', service: 'slack' })
    const invalid = new Request('http://fleet.test', { headers: { authorization: 'Bearer wrong' } })
    expect(() => identifyFleetCaller(invalid, environment)).toThrow(FleetAuthenticationError)
  })

  it('rejects Slack counts over three at the authorization boundary', () => {
    const slack = { kind: 'service', service: 'slack' } as const
    expect(() => enforceCallerPolicy(slack, input)).not.toThrow()
    expect(() => enforceCallerPolicy(slack, { ...input, agentCount: 4 })).toThrow(FleetAuthorizationError)
    expect(() => enforceCallerPolicy(slack, { ...input, concurrency: 4 })).toThrow(FleetAuthorizationError)
  })
})
