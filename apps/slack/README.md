# Fleet Slack worker

This is a separately deployed Node 22 Socket Mode worker for one workspace and one channel. Copy `.env.example`, provide secrets outside Git, then run `pnpm dev:slack` from the repository root.

The worker accepts only `app_mention` events for team `T0BS0KMHZCM` and channel `C0BS2HGNHT8`. Every response targets the originating thread. It requests only `app_mentions:read` and `chat:write`; it does not read channel history, support DMs, slash commands, or untagged follow-ups.

Run exactly one replica with `FLEET_SLACK_DB_PATH` on a persistent volume. SQLite is intentional for v1; Redis and multi-replica coordination are out of scope.

## Verification map

- AC-1: `mention.test.ts`, `config.test.ts`, and backend service-auth tests prove exact-location admission and bearer handling with no wrong-channel effects.
- AC-2: `delivery.test.ts` proves every publish carries the persisted thread target, terminal-pending precedes the final update, and private traces are not rendered.
- AC-3: config and service-auth tests prove both three-agent ceilings.
- AC-4: delivery-store and delivery tests prove event-key deduplication, deterministic Fleet keys, monotonic cursors, and recovery phases.
- AC-5: fleet-client tests cover identical 425 retries, fragmented SSE, duplicates, snapshot gap repair, reconnect, cursor use, and terminal closure.
- AC-6: `pnpm check` covers root, client, and worker typecheck, tests, and builds.
- AC-7: `pnpm test:slack-backend` covers real local POST, GET, idempotency, and SSE with exactly three deterministic agents. Verify the installed app with one tagged Chrome smoke test in the approved channel.
