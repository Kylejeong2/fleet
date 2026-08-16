# Testing

Fleet tests the event invariant first, then the visible experience.

## Core check

```bash
pnpm check
```

This command runs TypeScript validation, Vitest, and the production build. Unit and integration coverage includes ordered reduction, duplicate and gap handling, journal idempotency, bounded concurrency, isolated worker failure, Search and Fetch trace transitions, and exactly one synthesis phase.

## Browser verification

Run `pnpm dev`, then use the Browser plugin to submit a prompt, observe the orchestrator without an automatic modal, open the fleet manually, inspect an agent trace, close it, and wait for the single synthesized answer. The same command serves both the client and the API routes.

## Live provider smoke test

Use a small run before increasing breadth:

```json
{
  "question": "What does Sail Research build? Use primary sources.",
  "agentCount": 3,
  "concurrency": 3,
  "profile": "live-workers"
}
```

Confirm that the journal contains real Search and Fetch successes and that all three agents reach a terminal state. This validates Sail and Browserbase, but it does not validate AI Gateway synthesis. Use `live` only after `AI_GATEWAY_API_KEY` is available.

Tests must never silently fall back from a requested live profile to deterministic providers.
