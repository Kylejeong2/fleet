import { timingSafeEqual } from 'node:crypto'
import type { CreateRunInput } from '@fleet/client'

export type FleetCaller = { kind: 'browser' } | { kind: 'service'; service: 'slack' }
export class FleetAuthenticationError extends Error {}
export class FleetAuthorizationError extends Error {}

const constantTimeMatch = (left: string, right: string) => {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export const identifyFleetCaller = (
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
): FleetCaller => {
  const authorization = request.headers.get('authorization')
  if (authorization === null) return { kind: 'browser' }
  const match = /^Bearer (.+)$/.exec(authorization)
  const configured = environment.FLEET_SLACK_SERVICE_TOKEN
  const supplied = match?.[1]
  if (!supplied || !configured || !constantTimeMatch(supplied, configured)) {
    throw new FleetAuthenticationError('Invalid Fleet service credential.')
  }
  return { kind: 'service', service: 'slack' }
}

export const enforceCallerPolicy = (caller: FleetCaller, input: CreateRunInput): void => {
  if (caller.kind === 'service' && (input.agentCount > 3 || input.concurrency > 3)) {
    throw new FleetAuthorizationError('Slack research runs are limited to three agents and three concurrent agents.')
  }
}
