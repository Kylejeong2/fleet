# Fleet Slack architecture

The Slack worker uses a SQLite inbox and runs as one replica. It validates each Slack event at ingress and saves accepted events before calling Fleet. A deterministic idempotency key links each Slack event to one Fleet run. The worker calls only the public Fleet HTTP API through `@fleet/client`. It does not import coordinator, Workflow, journal, provider, or frontend modules.

Each delivery has one checked state: `queued`, `following`, `terminal-pending`, `delivered`, or `failed`. The SQLite row stores the Slack event key, Fleet run ID, monotonic event cursor, originating thread timestamp, and status-message timestamp. Adapters parse Slack envelopes, environment variables, HTTP JSON, SSE frames, and SQLite rows before core code uses them.

The worker saves the complete public answer in `terminal-pending` before it replaces the status message and posts any remaining chunks. After a restart, the worker can either resume the Fleet event stream or finish Slack delivery. Slack and SQLite cannot share a transaction, so a crash after a Slack write but before the SQLite commit can duplicate a message.

The worker exposes no top-level message operation. Posting always requires the persisted thread timestamp, and updates require both that target and the status timestamp. Progress rendering uses only public status, completion counts, and agent activity; reasoning, tool bodies, findings, provider payloads, and raw errors never enter Slack output.

Version 1 does not use Redis or multi-replica leases. One approved channel does not justify a second state service or a distributed ownership protocol. Run exactly one worker replica with SQLite on a persistent volume. The app also omits `channels:history` because message history cannot close the transaction gap between Slack and SQLite. The event and configuration adapters reject DMs, slash commands, untagged follow-ups, and additional channels.

This feature does not include the unrelated Workflow context-parity change. The existing browser behavior and public route URLs remain unchanged; only requests carrying a valid Slack bearer principal receive the additional three-agent authorization ceiling.
