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

After resolved-address validation was added, run `a55022c1-e202-4eca-8783-1df9fe9b4857` repeated the live path with one worker. It completed in 10 seconds with one successful Search, three successful non-redirecting Fetch calls to `sailresearch.com`, a successful worker finding, and a 1,429-character deterministic synthesis. This verifies that the public-DNS guard still permits the intended Browserbase workflow.

## AI Gateway

On August 15, 2026, the complete `live` profile was repeated from `/Users/kylejeong/Desktop/fleet` after all three provider credentials became available. Credentials and provider response bodies were not logged.

Run `15fb6eae-846f-4247-82d2-a1a2ac8d5c08` completed in 15 seconds through Sail, Browserbase Search, and AI Gateway. Its worker made four successful Search calls, returned a finding, and handed it to the explicitly recorded `vercel-ai-gateway:openai/gpt-5.6-sol` synthesizer. The Gateway produced an 807-character final answer and the run reached `run.completed`.

Browser-driven run `e2c6e48a-9b57-4292-aef4-78dcd3ae62db` selected **Live fleet** in Chrome, received HTTP 202, opened the SSE event stream, displayed a succeeded agent, and rendered an 88-character Gateway answer. The final audit recorded no 4xx/5xx browser responses, console errors, or page exceptions.

The event journal was checked independently with completed run `7a75fde2-9b73-4a2b-bb7b-20c0a3578db0`. It contained 35 strictly ordered events from sequence 1 through 35, including one `synthesis.started`, 28 real `synthesis.delta` events, and one `run.completed`. Reopening the SSE endpoint with `Last-Event-ID: 10` returned sequences 11 through 35.

Two research-heavy attempts also exercised the failure path. Runs `552bbbf5-cb07-4609-8479-b02c105c1b92` and `c997b03b-ca07-41c3-a572-c13e47f00777` recorded 13 successful Browserbase Search/Fetch calls before Sail returned HTTP 503. Workers failed independently, no deterministic fallback was used, and synthesis correctly did not start when every worker lacked a finding. These failures remain useful evidence that paid-provider errors are visible rather than silently replaced.

## Actual UI reliability pass

The Chrome flow was then tested strictly through visible controls: select one agent, choose **Live fleet**, enter a research question, click **Launch fleet**, inspect tool cards in the modal, wait for the terminal badge, close the modal, and read the rendered answer. Runs were not created or polled through test-only API calls.

The first UI attempt, `ce13adc3-e9b3-49cc-a35b-96e724521dbe`, displayed one successful Search and two successful Fetch calls before a visible Sail HTTP 503 failure. Retry `a536caae-8db0-4c03-bfd0-a87ab7fcaf4a` displayed eight successful searches and 29 real sources, but the model ignored the stop instruction until the coordinator's turn limit failed the run. Both failures produced a correct failed modal and no fabricated answer.

Fleet now enforces a three-call evidence budget at the provider boundary. Once three Search or Fetch results are present, the next Sail request omits tool definitions and requires a source-aware finding. After this change, the same visible Chrome flow completed as run `053b01ef-e55d-42f6-8d1e-22004a07821c`: one Search, two Fetch calls, nine visible sources, one succeeded agent, 166 Gateway deltas, and a 792-character final answer rendered after the modal closed. The browser recorded no console errors, failed HTTP responses, or page exceptions.
