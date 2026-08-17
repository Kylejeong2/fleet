# Operations and limits

Fleet supports a local single-process runtime and a durable Vercel runtime.

## Readiness

Provider readiness depends on the selected profile. Development requires no external credentials. Live workers require Sail and Browserbase keys. Fully live runs also require an AI Gateway key. Missing configuration must reject a run before paid work starts.

The deployment funds runs of up to 10 agents. Requests above that threshold must include a complete Sail, Browserbase, and AI Gateway credential set. The browser settings UI keeps this set in local storage and sends it only for self-funded runs. Server-side validation enforces the same boundary, and public run events explicitly omit credentials.

## Runtime selection

With no override, Fleet uses Workflow when `VERCEL` is present and local execution elsewhere. Set `FLEET_EXECUTION_MODE=workflow` or `local` only to override that detection.

## Persistence

Local mode stores events and idempotency records in SQLite. Keep the database on persistent local storage and let one process own coordination.

Workflow mode stores execution history and stream chunks in Vercel's durable Workflow system. HTTP functions can scale independently and do not require process affinity or a writable filesystem. A Vercel KV or Upstash Redis REST integration is required only when clients send `Idempotency-Key`.

Do not run multiple local-mode instances against the same SQLite file over network storage.

## Limits

- At most 100 agents per run.
- Runs above 10 agents require caller-supplied provider credentials.
- At most 8 workers execute concurrently per run.
- Worker turns and fetched content are bounded by the provider adapters.
- One failed worker does not cancel its siblings.
- Synthesis requires at least one successful worker.

The per-run concurrency limit is not a global admission controller. Production deployments should add tenant quotas before accepting untrusted traffic.

## Recovery

In local mode, the SQLite journal reconstructs a run from committed events. In Workflow mode, durable steps resume after interruption and retry transient failures. External provider operations remain at-least-once across a crash boundary, so provider adapters must avoid unsafe side effects.

SSE consumers recover by replaying after their last committed sequence. A missing sequence triggers a snapshot refresh.

## Security

- Keep deployment provider keys server-side. Treat caller-supplied keys as request secrets.
- Never include caller-supplied keys in events, snapshots, responses, or logs.
- Never write authorization headers or raw provider responses to public events.
- Validate fetched URLs and external JSON.
- Bound stored excerpts and public error strings.
- Add authentication, tenant isolation, rate limits, and retention controls before exposing the service publicly.

## Deferred capabilities

Cancellation, encrypted artifacts, tenant quotas, and explicit retention policies remain outside this release. The HTTP and event contracts allow those changes without a new browser client.
