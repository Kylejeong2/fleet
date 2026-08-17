# HTTP API

Fleet exposes a small versioned contract under `/api/v1`. JSON request and response bodies are validated at the boundary.

Every operation requires a Clerk session cookie or supported bearer token. A run belongs to the active Clerk organization, falling back to the creating user for personal accounts. Reads from another tenant return `404`.

## Create a run

```http
POST /api/v1/runs
Content-Type: application/json
Idempotency-Key: optional-client-key
```

```json
{
  "question": "Where can cheap, high-throughput inference create a new product category?",
  "agentCount": 12,
  "concurrency": 4,
  "profile": "development"
}
```

Constraints:

- `question` contains 3 to 10,000 characters.
- `agentCount` is between 1 and 100.
- `concurrency` is between 1 and 8.
- `profile` is `development`, `live-workers`, or `live`.

The service responds as soon as the run is durably accepted. Provider work continues asynchronously. Repeating the same body and `Idempotency-Key` within the same tenant returns the original run. Reusing the key with a different body returns a conflict. The same key can be used independently by another tenant.

On Vercel, accepted IDs use the `wrun_…` Workflow format. A concurrent duplicate may briefly return `425 Too Early` with `Retry-After: 1` while its atomic idempotency reservation is being committed. Callers should retry the same request and key.

## Read a run

```http
GET /api/v1/runs/:runId
```

The response is the latest `RunSnapshot`. It contains the question, execution profile, run state, ordered agents, each agent's bounded tool trace, partial synthesis, final answer, and latest event sequence.

Run states are `running`, `synthesizing`, `completed`, `failed`, and `cancelled`. Agent states are `planned`, `running`, `succeeded`, and `failed`.

## Cancel a run

```http
DELETE /api/v1/runs/:runId
```

Cancellation is tenant-scoped and idempotent. It aborts active local provider calls or cancels the durable Workflow run, releases its admission lease, and returns the terminal `RunSnapshot`. Cancelling a completed, failed, or already-cancelled run returns its existing snapshot.

## Follow events

```http
GET /api/v1/runs/:runId/events
Accept: text/event-stream
Last-Event-ID: 17
```

The endpoint replays every committed event after the supplied cursor, then waits for new events. Clients that cannot set `Last-Event-ID` may use `?after=17`.

Each SSE message uses the event sequence as its `id`, the Fleet event kind as its `event`, and a full event object as JSON `data`.

Clients must apply events in sequence. A duplicate can be ignored. A gap means the local projection is stale: fetch the current snapshot and reconnect after `latestSequence`.

## Error handling

Boundary errors return JSON with a public message and an appropriate HTTP status. Provider failures do not normally fail the HTTP connection. They become typed events so every client sees the same durable outcome.

Secrets, raw provider responses, and stack traces are never part of the public event contract.

Admission failures include a `Retry-After` header. Per-user fleet, token, and request limits return `429`; exhausted global provider capacity returns `503`.

## Read usage

`GET /api/v1/usage` returns the signed-in user's current UTC-day input, output, and total token counts; outstanding reserved tokens; known USD cost; unpriced request count; and active fleet count. Gateway synthesis uses the Gateway generation record for exact cost. Sail cost is calculated from the configured per-million-token rates; without those rates, its tokens are still counted and the request is marked unpriced.
