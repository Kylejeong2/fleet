import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parseRunId } from '../../../../lib/fleet-protocol'
import { getFleetService, RunNotFoundError } from '../../../../server/fleet/service'

export const Route = createFileRoute('/api/v1/runs/$runId')({
  server: {
    handlers: {
      GET: ({ params }) => {
        try {
          return Response.json(getFleetService().getRun(parseRunId(params.runId)))
        } catch (error) {
          if (error instanceof z.ZodError) {
            return Response.json({ error: 'Invalid run ID' }, { status: 400 })
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
