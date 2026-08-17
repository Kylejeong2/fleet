# Fleet

Fleet creates subagents to truly perform deep research any prompt. A configurable fleet of subagent workers explore separate angles of a query equipped with Browserbase Search and Fetch. An orchestrator then synthesizes their evidence into one answer while the interface exposes every agent, tool call, and failure.

When inference is cheap enough, breadth becomes a feature. Fleet spends additional tokens on independent perspectives, source checking, and synthesis instead of hiding the work behind a single progress spinner.

## What is included

- A Clerk-authenticated TanStack Start chat interface with live orchestration activity in the conversation plus a compact fleet modal and per-agent trace drawer.
- An HTTP research service that is independent of React and reusable by other clients.
- A replayable Server-Sent Events protocol backed locally by SQLite and on Vercel by a durable Workflow stream.
- Durable, bounded parallel workers with isolated failures, exponential retries, and explicit provider activity.
- Deterministic development adapters for local work without paid API calls.
- Live Sail and Browserbase adapters, plus GPT-5.6 Sol synthesis through Vercel AI Gateway.

## Start locally

Fleet requires Node.js 22.12 or newer.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open the URL printed by Vite. The interface launches full fleets, so local use requires `SAIL_API_KEY`, `BROWSERBASE_API_KEY`, and `AI_GATEWAY_API_KEY`. Each run uses Sail researchers, Browserbase tools, and AI Gateway synthesis with `openai/gpt-5.6-sol`.

## Verify the build

```bash
pnpm check
```

`pnpm check` type-checks the application, runs unit and integration tests, and creates the production build. Verify the visible research flow against `pnpm dev` in the Browser plugin.

## Deploy on Vercel

Fleet automatically selects its Vercel Workflow runtime when `VERCEL` is present. A request starts one durable workflow, fans research agents into concurrency-bounded step batches, and returns immediately with a Workflow run ID. Agents and synthesis can retry independently without depending on the lifetime of the HTTP function that accepted the run.

Configure Clerk, the provider variables, and a Vercel KV or Upstash Redis integration from `.env.example`. Redis stores tenant ownership plus the short request-to-workflow reservation, while Workflow owns execution state and the resumable event stream. `FLEET_EXECUTION_MODE=workflow` can force this path outside Vercel, and `local` can force the SQLite path.

## Documentation

- [Architecture](docs/architecture.md)
- [HTTP API](docs/api.md)
- [Event protocol](docs/events.md)
- [Agent animation](docs/animation.md)
- [Providers and execution profiles](docs/providers.md)
- [Local development](docs/local-development.md)
- [Testing](docs/testing.md)
- [Live verification](docs/live-verification.md)
- [Operations and limits](docs/operations.md)

## Runtime model

The HTTP routes depend on one runtime boundary. Local development uses SQLite and an in-process coordinator for speed. Vercel production uses durable Workflow steps and streams, so no server instance, local disk, or in-memory singleton owns an active run.
