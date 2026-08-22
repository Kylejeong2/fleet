import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parseRunId } from '../../../../../lib/fleet-protocol'
import { RunNotFoundError } from '../../../../../server/fleet/service'
import { getFleetRuntime } from '../../../../../server/fleet/runtime'
import {
  requireFleetActor,
  UnauthenticatedError,
} from '../../../../../server/auth'

const CursorSchema = z.coerce.number().int().nonnegative()
export const Route = createFileRoute('/api/v1/runs/$runId/events')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const actor = await requireFleetActor()
          const runId = parseRunId(params.runId)
          const url = new URL(request.url)
          const rawCursor = url.searchParams.get('after') ?? request.headers.get('last-event-id') ?? '0'
          const after = CursorSchema.parse(rawCursor)
          return new Response(await getFleetRuntime().createEventStream(actor, runId, after), {
            headers: {
              'cache-control': 'no-cache, no-transform',
              connection: 'keep-alive',
              'content-type': 'text/event-stream; charset=utf-8',
            },
          })
        } catch (error) {
          if (error instanceof z.ZodError) {
            return Response.json({ error: 'Invalid event cursor or run ID' }, { status: 400 })
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
