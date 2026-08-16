# Live verification

This record contains sanitized integration evidence. It omits credentials, raw provider payloads, fetched page text, and model findings.

## Sail and Browserbase

On August 15, 2026, Fleet submitted this three-worker `live-workers` run:

```json
{
  "question": "What does Sail Research build, and what product advantage does its inference architecture claim? Use primary sources.",
  "agentCount": 3,
  "concurrency": 3,
  "profile": "live-workers"
}
```

Run `508fb949-e1f1-4309-b546-6e18d3dca017` completed in 38 seconds. All three agents started concurrently and reached terminal states. One agent returned a finding. Two failed independently, one at the eight-turn limit and one after a Sail HTTP 503. The successful finding was enough for the explicitly named deterministic synthesizer to complete a 3,227-character answer.

The committed trace contained successful Browserbase Search and Fetch calls for every worker. The event endpoint was then reopened with `Last-Event-ID: 20`; it returned 60 strictly ordered events, beginning at 21 and ending at 80 with `run.completed`.

Two earlier runs exposed and isolated Sail's ASAP-only request constraint. Background mode and request idempotency headers both returned HTTP 400. The adapter now uses synchronous Responses calls while Fleet's coordinator and SSE journal provide asynchronous product progress.

This is an integration smoke test, not a permanent live test suite. Reproduce it with the request above after setting `SAIL_API_KEY` and `BROWSERBASE_API_KEY`. Paid profiles never fall back to deterministic workers or tools.

## AI Gateway

The `openai/gpt-5.6-sol` adapter builds and type-checks through Vercel AI SDK. It was not called live because `AI_GATEWAY_API_KEY` was unavailable during verification. Selecting the `live` profile without that key returns an explicit readiness error before provider work begins.
