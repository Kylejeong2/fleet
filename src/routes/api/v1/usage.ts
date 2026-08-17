import { createFileRoute } from '@tanstack/react-router'
import {
  requireFleetActor,
  UnauthenticatedError,
} from '../../../server/auth'
import {
  AdmissionRejectedError,
  getFleetRuntime,
} from '../../../server/fleet/runtime'
import { ProfileNotReadyError } from '../../../server/fleet/service'

export const Route = createFileRoute('/api/v1/usage')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const actor = await requireFleetActor()
          const runtime = getFleetRuntime()
          await runtime.checkRate(actor, 'read')
          return Response.json(await runtime.usage(actor))
        } catch (error) {
          if (error instanceof UnauthenticatedError) {
            return Response.json({ error: error.message }, { status: 401 })
          }
          if (error instanceof AdmissionRejectedError) {
            return Response.json(
              { error: error.message },
              {
                status: 429,
                headers: { 'retry-after': String(error.retryAfterSeconds) },
              },
            )
          }
          if (error instanceof ProfileNotReadyError) {
            return Response.json({ error: error.message }, { status: 503 })
          }
          throw error
        }
      },
    },
  },
})
