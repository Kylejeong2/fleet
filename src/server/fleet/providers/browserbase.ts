import { z } from 'zod'
import { HttpUrlSchema } from '../../../lib/fleet-protocol'
import type { ResearchToolCall, ResearchToolResult, ResearchTools } from '../ports'

const SearchResponseSchema = z.object({
  results: z.array(
    z.object({
      url: HttpUrlSchema,
      title: z.string(),
    }),
  ),
})

const FetchResponseSchema = z.object({
  content: z.string(),
  contentType: z.string(),
  statusCode: z.number().int(),
})

const MAX_SEARCH_RESULTS = 8
const MAX_FETCH_CHARACTERS = 24_000

export class BrowserbaseResearchTools implements ResearchTools {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.browserbase.com/v1',
  ) {}

  async execute(call: ResearchToolCall, signal: AbortSignal): Promise<ResearchToolResult> {
    if (call.kind === 'search') {
      const response = await this.#request('/search', {
        query: call.query.slice(0, 200),
        numResults: MAX_SEARCH_RESULTS,
      }, signal)
      if (!response.ok) throw new Error(`Browserbase Search failed with ${response.status}`)
      const payload = SearchResponseSchema.parse(await response.json())
      return {
        kind: 'search',
        results: payload.results.slice(0, MAX_SEARCH_RESULTS).map((result) => ({
          ...result,
          snippet: '',
        })),
      }
    }
    const url = HttpUrlSchema.parse(call.url)
    const response = await this.#request('/fetch', {
      url,
      allowRedirects: true,
      allowInsecureSsl: false,
      proxies: false,
    }, signal)
    if (!response.ok) throw new Error(`Browserbase Fetch failed with ${response.status}`)
    const payload = FetchResponseSchema.parse(await response.json())
    if (payload.statusCode < 200 || payload.statusCode >= 400) {
      throw new Error(`Fetched page returned ${payload.statusCode}`)
    }
    return {
      kind: 'fetch',
      url,
      title: new URL(url).hostname,
      text: payload.content.slice(0, MAX_FETCH_CHARACTERS),
    }
  }

  async #request(
    path: string,
    body: object,
    signal: AbortSignal,
  ): Promise<Response> {
    // A network exception cannot prove Browserbase rejected a paid call, so do not duplicate it.
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bb-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    })
  }
}
