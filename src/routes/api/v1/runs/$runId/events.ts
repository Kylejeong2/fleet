import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parseRunId } from '../../../../../lib/fleet-protocol'
import { getFleetService, RunNotFoundError } from '../../../../../server/fleet/service'
import { createFleetEventStream } from '../../../../../server/fleet/sse'

const CursorSchema = z.coerce.number().int().nonnegative()
export const Route = createFileRoute('/api/v1/runs/$runId/events')({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        try {
          const runId = parseRunId(params.runId)
          const url = new URL(request.url)
          const rawCursor = url.searchParams.get('after') ?? request.headers.get('last-event-id') ?? '0'
          const after = CursorSchema.parse(rawCursor)
          getFleetService().events(runId, after)
          return new Response(createFleetEventStream(getFleetService(), runId, after), {
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
          if (error instanceof RunNotFoundError) {
            return Response.json({ error: error.message }, { status: 404 })
          }
          throw error
        }
      },
    },
  },
})
