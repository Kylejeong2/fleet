import { describe, expect, it } from 'vitest'
import { actorFromIdentity } from './auth'

describe('Fleet actor identity', () => {
  it('uses the active organization as the tenant', () => {
    expect(actorFromIdentity({ userId: 'user_1', orgId: 'org_1' })).toEqual({
      userId: 'user_1',
      tenantId: 'org_1',
    })
  })

  it('isolates personal accounts by user', () => {
    expect(actorFromIdentity({ userId: 'user_1', orgId: null })).toEqual({
      userId: 'user_1',
      tenantId: 'user_1',
    })
  })

  it('rejects anonymous identities', () => {
    expect(actorFromIdentity({ userId: null, orgId: null })).toBeNull()
  })
})
