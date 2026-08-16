# Local development

## Prerequisites

- Node.js 22.12 or newer.
- pnpm 10.22.0. Corepack can install the version pinned in `package.json`.
- Provider credentials only when using a live profile.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The default database is `.fleet/fleet.sqlite`. The directory is ignored by Git. Delete only that specific file when you intentionally want a fresh local journal.

## Suggested loop

Use the `development` profile with 4 agents and concurrency 2 while changing the interface. It exercises planning, bounded execution, Search and Fetch traces, SSE replay, and synthesis without spending provider credits.

Before committing:

```bash
pnpm check
pnpm test:e2e
pnpm audit --audit-level=high
```

## Environment loading

TanStack Start loads `.env.local` for local development. Never commit that file. `.env.example` contains names and safe defaults only.

## Generated routes

TanStack Router owns `src/routeTree.gen.ts`. Change route files or generator configuration, then let Vite regenerate the tree. Do not edit the generated file directly.

## Common failures

If a live profile is rejected, check the required credentials for that profile. If an SSE client detects a sequence gap, fetch the snapshot and reconnect from its `latestSequence`. If the SQLite file cannot be opened, confirm that the process can write the `.fleet` directory.
