import { lookup } from 'node:dns/promises'
import { z } from 'zod'
import { HttpUrlSchema, isPublicIpAddress } from '../../../lib/fleet-protocol'
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

type HostResolver = (hostname: string) => Promise<string[]>

const resolveHost: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address)

export class BrowserbaseResearchTools implements ResearchTools {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.browserbase.com/v1',
    private readonly resolver: HostResolver = resolveHost,
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
    const addresses = await this.resolver(new URL(url).hostname)
    if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
      throw new Error('Fetch hostname did not resolve exclusively to public addresses')
    }
    const response = await this.#request('/fetch', {
      url,
      allowRedirects: false,
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
