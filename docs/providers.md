# Providers and execution profiles

Fleet separates the coordinator from three capabilities: a worker model, research tools, and a synthesizer. Each adapter implements one narrow port.

## Sail workers

Live workers call Sail's Responses-compatible API with `deepseek-ai/DeepSeek-V4-Flash`. The model receives one focused objective and may request Browserbase Search or Fetch. Tool results return to that worker until it produces a finding. Each worker has a three-call research-tool budget; after that budget is exhausted, Fleet removes tool definitions from the next model request and requires a source-aware finding. The coordinator's broader turn limit remains a final safety boundary.

Fleet does not claim that a pending Sail response is streaming. It records model and tool activity around each completed call.

Required variable:

```text
SAIL_API_KEY
```

Optional variables:

```text
SAIL_BASE_URL=https://api.sailresearch.com/v1
SAIL_RESEARCH_MODEL=deepseek-ai/DeepSeek-V4-Flash
```

## Browserbase tools

The Search and Fetch adapters send requests to Browserbase, validate the external response, and return bounded display-safe content. Fetch accepts only public HTTP and HTTPS URLs. Fleet resolves the hostname immediately before the provider call and requires every returned IPv4 or IPv6 address to be public. Browserbase redirects are disabled so the validated destination cannot redirect into a private network. Deployments must use a trusted DNS resolver because DNS validation and the remote Fetch request occur in separate network contexts.

Fleet avoids automatic retries after an ambiguous provider failure because the original paid request may have been accepted. The failure remains visible in the agent trace.

Required variable:

```text
BROWSERBASE_API_KEY
```

`BROWSERBASE_PROJECT_ID` is reserved for Browserbase features that require a project and is not needed by Search or Fetch.

## Gateway synthesis

The live synthesizer uses the Vercel AI SDK and AI Gateway model `openai/gpt-5.6-sol`. It receives each successful finding together with its agent ID and deduplicated Search and Fetch sources. The prompt requires detailed Markdown, inline links using only supplied URLs, and exact agent citation links that the interface resolves back to the supporting trace. Its real text deltas become `synthesis.delta` events.

A failed individual tool call remains visible in the agent trace and counts against its research budget. If the agent already has evidence, it may continue and produce a finding instead of losing the whole research angle because one page rejected Fetch.

Required variable:

```text
AI_GATEWAY_API_KEY
```

Optional variable:

```text
AI_GATEWAY_ORCHESTRATOR_MODEL=openai/gpt-5.6-sol
```

## Execution profiles

| Profile | Workers | Tools | Synthesizer | Intended use |
| --- | --- | --- | --- | --- |
| `development` | Deterministic | Deterministic | Deterministic | UI work, tests, and zero-cost demos. |
| `live-workers` | Sail | Browserbase | Deterministic | Verify parallel research without Gateway credentials. |
| `live` | Sail | Browserbase | AI Gateway | Complete provider-backed research. |

The snapshot records the profile and synthesizer name. A deterministic answer cannot present itself as a verified Gateway result.
