---
spec_format_version: "0.1"
title: "Fleet Slack App"
artifact_type: "prd"
spec_revision: 1
author: "Kyle Jeong"
created_at: "2026-08-23T00:00:00Z"
updated_at: "2026-08-23T00:00:00Z"
linked_github_repo: "Kylejeong2/fleet"
applies_to:
  - path: "apps/slack/"
  - path: "packages/fleet-client/"
  - component: "fleet-http-api"
---

## Problem

Fleet users in Slack cannot start and follow a durable research run without leaving the conversation, while the existing frontend and research runtime have separate lifecycles that should remain independently deployable.

## Hypothesis

If a tagged Slack message can launch Fleet through its public HTTP API and receive visible progress plus a terminal answer in the originating thread, users will complete research requests from Slack without opening the Fleet frontend.

## Product summary

This release adds a separately deployable Socket Mode Slack worker. It accepts tagged messages from one approved workspace and channel, calls Fleet through an authenticated typed HTTP client, follows replayable events, and updates one threaded Slack response through terminal completion.

## Scope

```productspec-scope
in:
  - Accept only app mentions from Slack team T0BS0KMHZCM and channel C0BS2HGNHT8.
  - Reply only in the originating Slack thread with visible public progress and a terminal result.
  - Cap Slack-initiated runs at three research agents and three concurrent agents in both worker configuration and backend authorization.
  - Persist delivery state so duplicate Slack events and worker restarts converge on one Fleet run and one Slack thread.
  - Package the Slack worker and Fleet HTTP client as independently testable workspace packages.
out:
  - Support direct messages, slash commands, untagged follow-ups, file ingestion, interactive controls, or any Slack channel other than C0BS2HGNHT8.
  - Change Fleet research quality, provider selection, or the frontend experience.
  - Add multi-replica Slack worker scaling or require Redis for Slack delivery state.
  - Claim exactly-once Slack message creation across a crash after Slack accepts a post but before local state commits.
cut:
  - Read Slack channel history to reconcile the initial-message crash window, because that would require broader Slack permissions for a one-channel first release.
```

## Acceptance criteria

```productspec-acceptance-criteria
- id: AC-1
  criterion: Only an app_mention from team T0BS0KMHZCM and channel C0BS2HGNHT8 can create durable delivery state, call Fleet, or post to Slack.
- id: AC-2
  criterion: An accepted mention receives progress and exactly one terminal result in its originating thread, with no top-level bot response and no raw model reasoning or fetched content.
- id: AC-3
  criterion: Slack worker configuration rejects agent or concurrency values outside one through three, and the authenticated Fleet service principal rejects any Slack request above three before runtime creation.
- id: AC-4
  criterion: Replaying one Slack event or restarting the worker from every persisted nonterminal state resumes the same Fleet run and Slack thread without starting a second run.
- id: AC-5
  criterion: The Fleet client retries a pending idempotency reservation with the same request, repairs event-sequence gaps from a snapshot, ignores duplicates, reconnects from its cursor, and closes on completed or failed runs.
- id: AC-6
  criterion: The existing Fleet frontend and backend checks pass after the workspace change, and the Slack worker builds and runs as a separate Node process.
- id: AC-7
  criterion: A live Chrome smoke test posts one tagged request only in team T0BS0KMHZCM and channel C0BS2HGNHT8 with exactly three agents, then observes threaded progress and a terminal answer in that same thread.
```

## Success metrics

```productspec-success-metrics
- id: SM-1
  metric: tagged_slack_runs_with_terminal_thread_delivery
  target: tbd
  target_status: provisional
  target_owner: Kyle Jeong
  window: within 14 days after the Slack worker is deployed
- id: SM-2
  metric: duplicate_fleet_runs_per_slack_event
  target: "= 0"
  target_status: committed
  window: within 14 days after the Slack worker is deployed
```

## Solution

The repository becomes a pnpm workspace while the existing TanStack Start application remains at the root. A shared Fleet client owns HTTP status handling and SSE recovery. A Socket Mode worker owns exact-channel admission, a typed delivery state machine, SQLite persistence, Slack rendering, and process recovery. Fleet routes map one bearer credential to a Slack service principal whose run limit is three.

## Risks

Slack message creation and SQLite commits cannot form one transaction. A crash in the narrow interval after Slack accepts the first reply and before its timestamp commits can create a duplicate status message after restart. This release documents that at-least-once edge and keeps all later progress and terminal writes idempotent by updating the persisted message timestamp.

## Rollout

Automated checks and a deterministic three-agent backend integration test run first. The Slack app is then installed only in the approved workspace and added only to the approved channel. Chrome sends one tagged live request in that channel. Wrong-channel behavior is proven with fakes rather than messages to another channel.
