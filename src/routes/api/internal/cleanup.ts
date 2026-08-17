import { timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { createRedisCommand } from '../../../server/fleet/ownership'
import {
  cleanupExpiredRedisRuns,
  createRetentionConfig,
} from '../../../server/fleet/retention'

export const Route = createFileRoute('/api/internal/cleanup')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET
        if (!secret) {
          return Response.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
        }
        const provided = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
        if (!safeEqual(provided, secret)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const workflowMode = process.env.FLEET_EXECUTION_MODE === 'workflow' || Boolean(process.env.VERCEL)
        if (!workflowMode) {
          const { getFleetService } = await import('../../../server/fleet/service')
          const config = createRetentionConfig(process.env)
          const deleted = getFleetService().journal.cleanupExpired(
            new Date(Date.now() - config.FLEET_RUN_RETENTION_DAYS * 86_400_000),
          )
          return Response.json({ deleted })
        }
        const deleted = await cleanupExpiredRedisRuns(createRedisCommand(process.env))
        return Response.json({ deleted })
      },
    },
  },
})

const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
