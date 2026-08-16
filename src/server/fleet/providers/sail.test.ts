import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentId, createRunId } from '../../../lib/fleet-protocol'
import { SailWorkerModel } from './sail'

afterEach(() => vi.unstubAllGlobals())

describe('SailWorkerModel', () => {
  it('uses the synchronous shape supported by ASAP-only models and preserves reasoning summaries', async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      Response.json({
        id: 'response-1',
        status: 'completed',
        output: [
          { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'Thinking' }] },
          {
            type: 'function_call',
            name: 'search',
            arguments: JSON.stringify({
              query: 'Sail Research inference',
              reasoning: 'A search will identify the primary Sail product sources.',
            }),
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', request)

    const runId = createRunId()
    const result = await new SailWorkerModel('test-key').respond(
      {
        question: 'What does Sail build?',
        objective: 'Find primary sources',
        agentId: createAgentId(runId, 0),
        history: [],
      },
      new AbortController().signal,
    )

    expect(result).toEqual({
      kind: 'tool-call',
      call: {
        kind: 'search',
        query: 'Sail Research inference',
        reasoning: 'A search will identify the primary Sail product sources.',
      },
      reasoning: 'Thinking',
    })
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('background')
    expect(body).not.toHaveProperty('metadata')
    expect(request.mock.calls[0]?.[1]?.headers).not.toHaveProperty('idempotency-key')
  })

  it('uses the model-authored tool rationale when no reasoning summary is returned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      id: 'response-rationale',
      status: 'completed',
      output: [{
        type: 'function_call',
        name: 'search',
        arguments: JSON.stringify({
          query: 'CPU cache primary source',
          reasoning: 'I need a primary technical source before comparing cache levels.',
        }),
      }],
    })))

    const runId = createRunId()
    const result = await new SailWorkerModel('test-key').respond(
      {
        question: 'What is a CPU cache?',
        objective: 'Find definitions',
        agentId: createAgentId(runId, 0),
        history: [],
      },
      new AbortController().signal,
    )

    expect(result).toMatchObject({
      kind: 'tool-call',
      reasoning: 'I need a primary technical source before comparing cache levels.',
    })
  })

  it('removes tools and requires a finding after the evidence budget is exhausted', async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      Response.json({
        id: 'response-2',
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'A bounded source-aware finding.' }],
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', request)

    const runId = createRunId()
    const result = await new SailWorkerModel('test-key').respond(
      {
        question: 'What does Sail build?',
        objective: 'Find primary sources',
        agentId: createAgentId(runId, 0),
        history: Array.from({ length: 3 }, (_, index) => ({
          call: { kind: 'search' as const, query: `query ${index}` },
          result: { kind: 'search' as const, results: [] },
        })),
      },
      new AbortController().signal,
    )

    expect(result).toEqual({ kind: 'finding', finding: 'A bounded source-aware finding.' })
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('tools')
    expect(body.input).toContain('tool budget is exhausted')
  })
})
