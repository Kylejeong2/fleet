# Fleet architecture

Fleet runs many web researchers against one question and returns one cited answer. The browser calls Fleet through HTTP. The research engine does not import React, TanStack Start, or browser state.

This document explains the first complete implementation. The design keeps the service boundary stable while using a single Node.js process and SQLite for local execution.

## Caller contract

Clients use three operations.

```http
POST /api/v1/runs
GET /api/v1/runs/:runId
GET /api/v1/runs/:runId/events
```

`POST /api/v1/runs` accepts a question, an agent count, and an execution mode. It returns a run snapshot before provider work finishes. The request accepts an `Idempotency-Key` header. Repeating the same request with the same key returns the first run.

`GET /api/v1/runs/:runId` returns the latest projection. The projection includes every agent, the bounded trace for each agent, the partial synthesis, the terminal answer, and the latest event sequence.

`GET /api/v1/runs/:runId/events` returns Server-Sent Events after a sequence cursor. Browsers can pass `Last-Event-ID`. Other clients can pass `?after=<sequence>`. A client that reconnects replays committed events before receiving new ones.

Future Slack agents use the same contract. They do not import the research engine.

## Domain model

The run journal is the source of truth. A `RunEvent` records one fact. The pure reducer derives the current `RunSnapshot` from ordered events.

The event union covers these facts:

- The service accepted a run.
- The coordinator planned an agent.
- An agent started or changed activity.
- An agent requested, completed, or failed a tool call.
- An agent completed or failed.
- Synthesis started or produced a text delta.
- The run completed or failed.

Every event has a run-scoped integer sequence. Duplicate events at or below the current sequence are safe to ignore. A gap forces the client to replace its projection with a fresh snapshot before it resumes.

Agent and tool states use discriminated unions. A completed tool call always has a result. A failed tool call always has a public error. A running tool call has neither. These shapes prevent the interface from rendering contradictory states.

## Execution ownership

One `RunCoordinator` owns transitions for one run. Research agents run concurrently, but they report typed facts to the coordinator. Agents never mutate the journal or shared run state.

The coordinator uses a bounded work queue. It starts no more than the configured concurrency. One agent failure does not cancel its siblings. Synthesis starts after every planned agent reaches a terminal state. At least one successful agent is required.

The first implementation runs the coordinator in the Fleet server process. SQLite stores committed events and idempotency records. On startup, the service can replay incomplete runs and reconcile their projection. The SQLite adapter is a local and single-host implementation. A future production service can replace it with PostgreSQL without changing the HTTP protocol or the reducer.

## Provider boundaries

The engine depends on three capability-shaped ports.

```ts
interface WorkerModel {
  respond(turn: WorkerTurn, signal: AbortSignal): Promise<WorkerResponse>
}

interface ResearchTools {
  execute(call: ResearchToolCall, signal: AbortSignal): Promise<ResearchToolResult>
}

interface Synthesizer {
  stream(input: SynthesisInput, signal: AbortSignal): AsyncIterable<string>
}
```

`SailWorkerModel` calls the stable Sail Responses API with `deepseek-ai/DeepSeek-V4-Flash`. Sail responses do not stream. Fleet reports accurate activity around each synchronous model turn and each local tool call. It never fabricates token deltas for a Sail worker. Explicit overload and transient HTTP responses use six bounded attempts with capped exponential backoff; ambiguous network failures still fail closed. The coordinator itself remains outside the request lifecycle, so accepting a run does not wait for research to finish.

`BrowserbaseResearchTools` calls Browserbase Search and Fetch. The adapter validates URLs, bounds fetched content, parses external JSON, and returns display-safe results. An ambiguous failure becomes a visible failed tool event rather than a duplicate paid call.

`GatewaySynthesizer` uses AI SDK with `openai/gpt-5.6-sol` through Vercel AI Gateway. Each synthesis finding includes its originating agent ID and deduplicated source URLs. The model streams detailed Markdown with inline source links and exact agent citation anchors; the browser converts those anchors into controls that open the matching trace. Its text deltas become synthesis events. If `AI_GATEWAY_API_KEY` is absent, only explicit development mode can select the deterministic synthesizer. The final snapshot names the synthesizer so development output cannot look like a verified Gateway result.

## Browser state

TanStack Start renders the conversation shell, header, and composer on the server. The initial page does not wait for a research run.

The route owns one active projection and replay cursor. Its SSE reader reduces typed events in order, ignores duplicates, and replaces the projection from the snapshot endpoint after a gap. The message surface receives the projection as data and does not open a second event stream.

The route owns the current run, selected agent, and composer settings for this single-conversation release. The trace panel owns only its expanded tool cards. Agent animation derives from agent status. There is no second animation state to synchronize.

The main conversation owns the live orchestrator messages, subagent reasoning summaries, and expandable Search and Fetch activity. Fleet opens only when requested and dedicates two-thirds of its compact modal to a scrollable grid of bot-and-name agent cards; selecting one updates the one-third trace drawer. The answer uses a safe Markdown renderer without raw HTML: HTTP source links open externally, while exact `#fleet-agent=` links become compact buttons that open Fleet on the cited agent. Closing a layer restores focus to its trigger. Reduced-motion mode removes movement while keeping text status and progress.

## Deferred production machinery

The first build does not add a separate event broker, Redis, Kafka, encrypted artifact storage, cancellation, multi-host leases, or global admission SQL. None of those change the user experience that this build must prove.

The event journal, provider ports, idempotent start operation, and cursor protocol preserve the path to a long-lived service. A production deployment can move execution into a dedicated worker and replace SQLite with PostgreSQL without changing browser or Slack clients.

## Design synthesis

Three independent architecture candidates converged on a journal-first service and replayable event stream. Candidate 2 became the base because it handled provider recovery and browser state ownership most precisely. The implementation adopts candidate 1's conservative external retry rule and candidate 3's cursor recovery behavior.

The first build compresses the proposed multi-package layout into one application with clear server-only modules. This keeps the common trace under three files while preserving the HTTP boundary.
