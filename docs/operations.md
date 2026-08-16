# Operations and limits

Fleet's first implementation is designed for one long-running Node.js process.

## Readiness

Provider readiness depends on the selected profile. Development requires no external credentials. Live workers require Sail and Browserbase keys. Fully live runs also require an AI Gateway key. Missing configuration must reject a run before paid work starts.

## Persistence

SQLite stores events and idempotency records. Keep the database on persistent local storage and back it up as one application data file. The journal uses write-ahead logging and one process owns coordination.

Do not run multiple Fleet server instances against the same SQLite file over network storage. Moving to multiple hosts requires a shared transactional database, run leases, and a cross-process event notification mechanism.

## Limits

- At most 100 agents per run.
- At most 8 workers execute concurrently per run.
- Worker turns and fetched content are bounded by the provider adapters.
- One failed worker does not cancel its siblings.
- Synthesis requires at least one successful worker.

The request-level concurrency limit is not a global admission controller. Production deployments should add tenant quotas and a process-wide concurrency budget before accepting untrusted traffic.

## Recovery

The journal can reconstruct a run from committed events. On an unexpected restart, inspect incomplete runs before resuming provider work. The first implementation does not promise exactly-once external model or tool calls across a crash boundary.

SSE consumers recover by replaying after their last committed sequence. A missing sequence triggers a snapshot refresh.

## Security

- Keep provider keys server-side.
- Never write authorization headers or raw provider responses to public events.
- Validate fetched URLs and external JSON.
- Bound stored excerpts and public error strings.
- Add authentication, tenant isolation, rate limits, and retention controls before exposing the service publicly.

## Deferred capabilities

Cancellation, encrypted artifacts, distributed leases, a shared event broker, and PostgreSQL are intentionally outside the first single-host release. The HTTP and event contracts are designed so those changes do not require a new browser client.
