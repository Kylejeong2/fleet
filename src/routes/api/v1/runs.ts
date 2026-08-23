import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CreateRunInputSchema } from '@fleet/client'
import {
  IdempotencyConflictError,
  ProfileNotReadyError,
} from '../../../server/fleet/service'
import { getFleetRuntime, RunStartPendingError } from '../../../server/fleet/runtime'
import {
  enforceCallerPolicy,
  FleetAuthenticationError,
  FleetAuthorizationError,
  identifyFleetCaller,
} from '../../../server/fleet/service-auth'

const IdempotencyKeySchema = z.string().trim().min(1).max(200)

export const Route = createFileRoute('/api/v1/runs')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const caller = identifyFleetCaller(request)
          const body: unknown = await request.json()
          const input = CreateRunInputSchema.parse(body)
          enforceCallerPolicy(caller, input)
          const rawKey = request.headers.get('idempotency-key')
          const idempotencyKey = rawKey ? IdempotencyKeySchema.parse(rawKey) : null
          const snapshot = await getFleetRuntime().createRun({ input, idempotencyKey })
          return Response.json(snapshot, { status: 202 })
        } catch (error) {
          if (error instanceof FleetAuthenticationError) {
            return Response.json({ error: error.message }, { status: 401 })
          }
          if (error instanceof FleetAuthorizationError) {
            return Response.json({ error: error.message }, { status: 403 })
          }
          if (error instanceof z.ZodError) {
            return Response.json(
              { error: 'Invalid run request', issues: error.issues },
              { status: 400 },
            )
          }
          if (error instanceof IdempotencyConflictError) {
            return Response.json({ error: error.message }, { status: 409 })
          }
          if (error instanceof ProfileNotReadyError) {
            return Response.json({ error: error.message }, { status: 503 })
          }
          if (error instanceof RunStartPendingError) {
            return Response.json(
              { error: error.message },
              { status: 425, headers: { 'retry-after': '1' } },
            )
          }
          throw error
        }
      },
    },
  },
})
