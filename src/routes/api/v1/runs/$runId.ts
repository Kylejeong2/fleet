import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parseRunId } from '../../../../lib/fleet-protocol'
import { RunNotFoundError } from '../../../../server/fleet/service'
import { getFleetRuntime } from '../../../../server/fleet/runtime'

export const Route = createFileRoute('/api/v1/runs/$runId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          return Response.json(await getFleetRuntime().getRun(parseRunId(params.runId)))
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
