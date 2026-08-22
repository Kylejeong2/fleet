import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parseRunId } from '../../../../lib/fleet-protocol'
import { RunNotFoundError } from '../../../../server/fleet/service'
import { getFleetRuntime } from '../../../../server/fleet/runtime'
import {
  requireFleetActor,
  UnauthenticatedError,
} from '../../../../server/auth'

export const Route = createFileRoute('/api/v1/runs/$runId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const actor = await requireFleetActor()
          return Response.json(
            await getFleetRuntime().getRun(actor, parseRunId(params.runId)),
          )
        } catch (error) {
          if (error instanceof z.ZodError) {
            return Response.json({ error: 'Invalid run ID' }, { status: 400 })
          }
          if (error instanceof UnauthenticatedError) {
            return Response.json({ error: error.message }, { status: 401 })
          }
          if (error instanceof RunNotFoundError) {
            return Response.json({ error: error.message }, { status: 404 })
          }
          throw error
        }
      },
    },
  },
})
