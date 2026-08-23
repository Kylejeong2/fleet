import { describe, expect, it, vi } from 'vitest'
import { createFleetClient } from './client.js'
import { RunIdSchema, type RunSnapshot } from './protocol.js'

const runId = RunIdSchema.parse('123e4567-e89b-42d3-a456-426614174000')
const base = (latestSequence: number, status: RunSnapshot['status'] = 'running'): RunSnapshot => ({
  id: runId, question: 'research this', agentCount: 3, concurrency: 3, profile: 'development',
  status, orchestratorTrace: [], orchestratorReasoning: '', agents: [], partialAnswer: '',
  finalAnswer: status === 'completed' ? 'done' : null, synthesizer: null, error: null, latestSequence,
})
const json = (value: unknown, init?: ResponseInit) => Response.json(value, init)
const stream = (...chunks: string[]) => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    controller.close()
  },
}), { headers: { 'content-type': 'text/event-stream' } })

describe('FleetClient', () => {
  it('retries 425 with the identical body and idempotency key', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; key: string | null }> = []
    const request = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push({ body: init?.body, key: headers.get('idempotency-key') })
      return calls.length === 1
        ? json({ error: 'pending' }, { status: 425, headers: { 'retry-after': '0' } })
        : json(base(1), { status: 202 })
    })
    const client = createFleetClient({ baseUrl: new URL('http://fleet.test'), authorization: { kind: 'bearer', token: 'secret' }, fetch: request as typeof fetch })
    await client.createRun({ question: 'research this', idempotencyKey: 'slack:v1:event', execution: { profile: 'development', agentCount: 3, concurrency: 3 } })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(calls[1])
  })

  it('parses fragmented SSE, ignores duplicates, repairs a gap from GET, and stops terminal', async () => {
    let snapshots = 0
    const accepted = { kind: 'run.accepted', runId, sequence: 1, at: new Date().toISOString(), question: 'research this', agentCount: 3, concurrency: 3, profile: 'development' }
    const completed = { kind: 'run.completed', runId, sequence: 3, at: new Date().toISOString(), answer: 'done' }
    const frame = `data: ${JSON.stringify(accepted)}\n\ndata: ${JSON.stringify(completed)}\n\n`
    const request = vi.fn(async (url: URL | RequestInfo) => {
      const value = String(url)
      if (value.includes('/events')) return stream(frame.slice(0, 17), frame.slice(17, 83), frame.slice(83))
      snapshots += 1
      return json(snapshots === 1 ? base(1) : base(2))
    })
    const client = createFleetClient({ baseUrl: new URL('http://fleet.test'), authorization: { kind: 'bearer', token: 'secret' }, fetch: request as typeof fetch })
    const projections = []
    for await (const projection of client.follow(runId, { after: 0, signal: new AbortController().signal })) projections.push(projection)
    expect(snapshots).toBe(2)
    expect(projections.at(-1)).toMatchObject({ cursor: 3, terminal: true, snapshot: { finalAnswer: 'done' } })
  })

  it('reconnects from its cursor after a transport closes', async () => {
    let eventRequests = 0
    const completed = { kind: 'run.completed', runId, sequence: 2, at: new Date().toISOString(), answer: 'done' }
    const request = vi.fn(async (url: URL | RequestInfo) => {
      if (!String(url).includes('/events')) return json(base(1))
      eventRequests += 1
      return eventRequests === 1 ? stream('') : stream(`data: ${JSON.stringify(completed)}\n\n`)
    })
    const client = createFleetClient({ baseUrl: new URL('http://fleet.test'), authorization: { kind: 'bearer', token: 'secret' }, fetch: request as typeof fetch })
    for await (const _projection of client.follow(runId, { after: 0, signal: new AbortController().signal })) {}
    expect(eventRequests).toBe(2)
    const secondUrl = String(request.mock.calls.filter(([url]) => String(url).includes('/events'))[1][0])
    expect(secondUrl).toContain('after=1')
  })
})
