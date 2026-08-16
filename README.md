# Fleet

Fleet creates subagents to truly perform deep research any prompt. A configurable fleet of subagent workers explore separate angles of a query equipped with Browserbase Search and Fetch. An orchestrator then synthesizes their evidence into one answer while the interface exposes every agent, tool call, and failure.

When inference is cheap enough, breadth becomes a feature. Fleet spends additional tokens on independent perspectives, source checking, and synthesis instead of hiding the work behind a single progress spinner.

## What is included

- A TanStack Start chat interface with a research fleet modal and per-agent trace drawer.
- An HTTP research service that is independent of React and reusable by other clients.
- A replayable Server-Sent Events protocol backed by an ordered SQLite journal.
- Bounded parallel workers with isolated failures and explicit provider activity.
- Deterministic development adapters for local work without paid API calls.
- Live Sail and Browserbase adapters, plus GPT-5.6 Sol synthesis through Vercel AI Gateway.

## Start locally

Fleet requires Node.js 22.12 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the URL printed by Vite. Development runs are deterministic by default, so the complete interface works without credentials.

To exercise real workers, add `SAIL_API_KEY` and `BROWSERBASE_API_KEY`, then select the `live-workers` profile. Add `AI_GATEWAY_API_KEY` for fully live synthesis with `openai/gpt-5.6-sol`.

## Verify the build

```bash
npm run check
npm run test:e2e
```

`npm run check` type-checks the application, runs unit and integration tests, and creates the production build. Browser tests cover the visible research flow separately.

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

## Status

Fleet is a complete single-host implementation. SQLite, in-process coordination, and the event stream are deliberate first-release choices. The stable HTTP boundary leaves room for a separate worker service and PostgreSQL without changing browser or future Slack clients.
