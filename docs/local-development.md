# Local development

## Prerequisites

- Node.js 22.12 or newer.
- pnpm 10.22.0. Corepack can install the version pinned in `package.json`.
- `SAIL_API_KEY`, `BROWSERBASE_API_KEY`, and `AI_GATEWAY_API_KEY` for launches from the interface.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The default database is `.fleet/fleet.sqlite`. The directory is ignored by Git. Delete only that specific file when you intentionally want a fresh local journal.

## Runtime logs

`pnpm dev` prints one structured line for every important fleet transition: run planning, agent starts, model responses, Search and Fetch calls, synthesis, failures, and final duration. Logs include short inputs and result sizes, but never credentials or fetched page bodies. Set `FLEET_LOG_LEVEL=silent` when you need a quiet terminal.

## Suggested loop

The interface always launches a full live fleet. Use small agent counts while changing the interface to limit provider spend. Deterministic adapters remain available to the unit and integration test suite.

Before committing:

```bash
pnpm check
pnpm audit --audit-level=high
```

## Environment loading

TanStack Start loads `.env.local` for local development. Never commit that file. `.env.example` contains names and safe defaults only.

## Generated routes

TanStack Router owns `src/routeTree.gen.ts`. Change route files or generator configuration, then let Vite regenerate the tree. Do not edit the generated file directly.

## Common failures

If a launch is rejected, check all three provider credentials. If an SSE client detects a sequence gap, fetch the snapshot and reconnect from its `latestSequence`. If the SQLite file cannot be opened, confirm that the process can write the `.fleet` directory.
