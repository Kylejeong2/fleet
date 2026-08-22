import { auth } from '@clerk/tanstack-react-start/server'

export type FleetActor = {
  userId: string
  tenantId: string
}

export class UnauthenticatedError extends Error {}

export const actorFromIdentity = (identity: {
  userId: string | null
  orgId: string | null | undefined
}): FleetActor | null => {
  if (!identity.userId) return null
  return {
    userId: identity.userId,
    tenantId: identity.orgId ?? identity.userId,
  }
}

export const requireFleetActor = async (): Promise<FleetActor> => {
  const identity = await auth()
  const actor = actorFromIdentity(identity)
  if (!actor) throw new UnauthenticatedError('Sign in to use Fleet.')
  return actor
}
