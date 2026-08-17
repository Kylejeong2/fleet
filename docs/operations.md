# Operations and limits

Fleet supports a local single-process runtime and a durable Vercel runtime.

## Readiness

Provider readiness depends on the selected profile. Development requires no external credentials. Live workers require Sail and Browserbase keys. Fully live runs also require an AI Gateway key. Missing configuration must reject a run before paid work starts.

## Runtime selection

With no override, Fleet uses Workflow when `VERCEL` is present and local execution elsewhere. Set `FLEET_EXECUTION_MODE=workflow` or `local` only to override that detection.

## Persistence

Local mode stores events and idempotency records in SQLite. Keep the database on persistent local storage and let one process own coordination.

Workflow mode stores execution history and stream chunks in Vercel's durable Workflow system. HTTP functions can scale independently and do not require process affinity or a writable filesystem. A Vercel KV or Upstash Redis REST integration is required for tenant ownership, idempotency, admission, rate limiting, and usage accounting.

Do not run multiple local-mode instances against the same SQLite file over network storage.

## Limits

- At most 100 agents per run.
- At most 8 workers execute concurrently per run.
- Worker turns and fetched content are bounded by the provider adapters.
- One failed worker does not cancel its siblings.
- Synthesis requires at least one successful worker.
- Global running worker slots default to 32 across all fleets.
- Each user defaults to 2 active fleets and 5,000,000 reserved-plus-used tokens per UTC day.
- Create requests default to 6 per minute per user; reads and stream connections default to 120.

All production limits are configurable through the `FLEET_*` variables in `.env.example`. Admission is atomic in Redis, and capacity leases expire if normal terminal cleanup cannot run.

## Usage accounting

`GET /api/v1/usage` exposes per-user daily tokens, known USD cost, unpriced request count, outstanding token reservations, and active fleets. Configure both `SAIL_INPUT_USD_PER_MILLION` and `SAIL_OUTPUT_USD_PER_MILLION` to cost Sail traffic. Gateway generations are tagged with the user and run and use the Gateway generation record for cost.

## Recovery

In local mode, the SQLite journal reconstructs a run from committed events. In Workflow mode, durable steps resume after interruption and retry transient failures. External provider operations remain at-least-once across a crash boundary, so provider adapters must avoid unsafe side effects.

SSE consumers recover by replaying after their last committed sequence. A missing sequence triggers a snapshot refresh.

## Security

- Keep provider keys server-side.
- Configure Clerk publishable and secret keys and require authentication on every run route.
- Treat the active Clerk organization as the tenant; personal accounts are isolated by user ID.
- Never write authorization headers or raw provider responses to public events.
- Validate fetched URLs and external JSON.
- Bound stored excerpts and public error strings.
- Keep tenant ownership checks on create, snapshot, event-stream, and future mutation routes.

## Deferred capabilities

Cancellation, encrypted artifacts, tenant quotas, and explicit retention policies remain outside this release. The HTTP and event contracts allow those changes without a new browser client.
