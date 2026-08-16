# HTTP API

Fleet exposes a small versioned contract under `/api/v1`. JSON request and response bodies are validated at the boundary.

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

The service responds as soon as the run is durably accepted. Provider work continues asynchronously. Repeating the same body and `Idempotency-Key` returns the original run. Reusing the key with a different body returns a conflict.

## Read a run

```http
GET /api/v1/runs/:runId
```

The response is the latest `RunSnapshot`. It contains the question, execution profile, run state, ordered agents, each agent's bounded tool trace, partial synthesis, final answer, and latest event sequence.

Run states are `running`, `synthesizing`, `completed`, and `failed`. Agent states are `planned`, `running`, `succeeded`, and `failed`.

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
