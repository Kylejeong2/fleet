# Event protocol

The ordered event journal is Fleet's source of truth. The server and browser derive a `RunSnapshot` by reducing events in sequence order.

## Event families

| Event | Meaning |
| --- | --- |
| `run.accepted` | The request and execution settings were persisted. |
| `agent.planned` | The coordinator assigned one distinct research objective. |
| `agent.started` | A worker acquired a bounded-concurrency slot. |
| `agent.activity` | The worker changed its public status. |
| `agent.reasoning` | One model-authored reasoning summary or tool rationale was committed. |
| `orchestrator.activity` | The orchestrator exposed a planning, dispatch, or review step. |
| `tool.started` | Search or Fetch began. |
| `tool.succeeded` | A validated, display-safe tool result was recorded. |
| `tool.failed` | A tool reached an explicit failure state. |
| `agent.succeeded` | The worker returned its finding. |
| `agent.failed` | The worker reached a terminal failure. |
| `synthesis.started` | The coordinator selected and started the synthesizer. |
| `synthesis.delta` | One real synthesizer text delta was committed. |
| `run.completed` | The complete answer was committed. |
| `run.failed` | The run could not produce an answer. |
| `run.cancelled` | The owner cancelled the run and provider work was stopped. |

Every event contains `runId`, a positive integer `sequence`, and an ISO 8601 `at` timestamp.

## Tool traces

Tool state is a discriminated union. A running trace has an input and start time. A succeeded trace adds a typed Search or Fetch result and completion time. A failed trace adds a public error and completion time. These states cannot accidentally contain both a result and an error.

The interface renders only these committed facts. Sail Responses calls are currently non-streaming, so an agent reasoning update appears when one model response completes, immediately before its resulting tool transition. Fleet records only model-provided reasoning summaries and concise tool rationales; it does not invent token animation or expose hidden chain-of-thought. Synthesis deltas are emitted only when the selected synthesizer actually streams text.

## Replay rules

The reducer handles three cases:

1. The next sequence is applied.
2. A sequence at or below the cursor is a duplicate and is ignored.
3. A sequence above the expected value is a gap and forces snapshot recovery.

The journal publishes only after a SQLite transaction commits. A reconnect therefore cannot observe an event that a later snapshot would omit.

## Adding an event

Add the schema to the `FleetEvent` discriminated union, teach the reducer how it changes the snapshot, add journal/replay tests, and then update every client projection. Prefer a new fact over widening an existing event into an ambiguous shape.
