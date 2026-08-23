import { describe, expect, it, vi } from 'vitest'
import { RunIdSchema, type FleetClient, type RunSnapshot } from '@fleet/client'
import { DeliveryService } from './delivery.js'
import { DeliveryStore } from './delivery-store.js'
import type { SlackMention } from './mention.js'
import { renderProgress, splitSlackAnswer, type SlackThreadPublisher } from './slack-thread.js'
import type { SlackContextReader } from './thread-context.js'

const runId = RunIdSchema.parse('123e4567-e89b-42d3-a456-426614174000')
const mention: SlackMention = {
  key: 'T0BS0KMHZCM:Ev1', eventId: 'Ev1', teamId: 'T0BS0KMHZCM', channelId: 'C0BS2HGNHT8',
  eventTs: '100.1', threadTs: '99.1', authorId: 'U1', question: 'research this',
}
const snapshot: RunSnapshot = {
  id: runId, question: mention.question, agentCount: 3, concurrency: 3, profile: 'development', status: 'completed',
  orchestratorTrace: [], orchestratorReasoning: 'private chain of thought', agents: [], partialAnswer: '',
  finalAnswer: 'final answer', synthesizer: null, error: null, latestSequence: 2,
}
const context: SlackContextReader = { read: vi.fn(async () => 'Earlier Slack message') }

describe('DeliveryService', () => {
  it('persists terminal-pending before final Slack delivery and uses only the originating thread', async () => {
    const store = new DeliveryStore(':memory:')
    const fleet: FleetClient = {
      createRun: vi.fn(async (): Promise<RunSnapshot> => ({ ...snapshot, status: 'running', finalAnswer: null, latestSequence: 1 })),
      getRun: vi.fn(async () => snapshot),
      async *follow() { yield { snapshot, cursor: 2, terminal: true } },
    }
    const calls: Array<{ kind: string; threadTs: string }> = []
    const slack: SlackThreadPublisher = {
      async publishStatus(target) { calls.push({ kind: 'post', threadTs: target.threadTs }); return '101.1' },
      async updateStatus(target, text) {
        calls.push({ kind: 'update', threadTs: target.threadTs })
        if (text === 'final answer') expect(store.get(mention.key).phase).toBe('terminal-pending')
      },
      async postAnswerRemainder(target) { calls.push({ kind: 'remainder', threadTs: target.threadTs }) },
    }
    const service = new DeliveryService(store, fleet, slack, context, { profile: 'development', agentCount: 3, concurrency: 3 })
    service.accept(mention)
    await service.idle()
    expect(store.get(mention.key).phase).toBe('delivered')
    expect(calls.every((call) => call.threadTs === '99.1')).toBe(true)
    expect(fleet.createRun).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'slack:v1:T0BS0KMHZCM:Ev1',
      question: expect.stringContaining('Earlier Slack message'),
    }))
    store.close()
  })

  it('never renders reasoning, tool bodies, findings, or provider errors as progress', () => {
    const progress = renderProgress({
      ...snapshot, status: 'running', finalAnswer: null,
      agents: [{ id: `${runId}:agent-1` as never, objective: 'private objective', status: 'running', activity: 'Searching public sources',
        reasoning: [{ sequence: 2 as never, at: new Date().toISOString(), text: 'secret reasoning' }], trace: [], finding: 'raw finding', error: 'provider payload' }],
    })
    expect(progress).toContain('Searching public sources')
    for (const secret of ['secret reasoning', 'raw finding', 'provider payload', 'private chain of thought']) expect(progress).not.toContain(secret)
    expect(splitSlackAnswer('a'.repeat(6_000)).every((chunk) => chunk.length <= 2_800)).toBe(true)
  })

  it('coalesces repeated progress while always delivering the terminal update', async () => {
    const store = new DeliveryStore(':memory:')
    const running: RunSnapshot = { ...snapshot, status: 'running', finalAnswer: null, latestSequence: 1 }
    const fleet: FleetClient = {
      createRun: vi.fn(async () => running),
      getRun: vi.fn(async () => snapshot),
      async *follow() {
        yield { snapshot: running, cursor: 1, terminal: false }
        yield { snapshot: { ...running, latestSequence: 2 }, cursor: 2, terminal: false }
        yield { snapshot, cursor: 3, terminal: true }
      },
    }
    const updates: string[] = []
    const slack: SlackThreadPublisher = {
      async publishStatus() { return '101.1' },
      async updateStatus(_target, text) { updates.push(text) },
      async postAnswerRemainder() {},
    }
    const service = new DeliveryService(store, fleet, slack, context, { profile: 'development', agentCount: 3, concurrency: 3 })
    service.accept(mention)
    await service.idle()
    expect(updates).toEqual(['final answer'])
    expect(store.get(mention.key).phase).toBe('delivered')
    store.close()
  })

  it('rescans durable work accepted while a drain is already running', async () => {
    const store = new DeliveryStore(':memory:')
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve })
    let createCalls = 0
    const fleet: FleetClient = {
      createRun: vi.fn(async () => {
        createCalls += 1
        if (createCalls === 1) await firstStarted
        const running: RunSnapshot = { ...snapshot, status: 'running', finalAnswer: null, latestSequence: 1 }
        return running
      }),
      getRun: vi.fn(async () => snapshot),
      async *follow() { yield { snapshot, cursor: 2, terminal: true } },
    }
    const slack: SlackThreadPublisher = {
      async publishStatus() { return `${Date.now()}.1` },
      async updateStatus() {},
      async postAnswerRemainder() {},
    }
    const service = new DeliveryService(store, fleet, slack, context, { profile: 'development', agentCount: 3, concurrency: 3 })
    service.accept(mention)
    await Promise.resolve()
    const second = { ...mention, key: 'T0BS0KMHZCM:Ev2', eventId: 'Ev2', eventTs: '200.1', threadTs: '200.1' }
    service.accept(second)
    releaseFirst()
    await service.idle()
    expect(fleet.createRun).toHaveBeenCalledTimes(2)
    expect(store.get(mention.key).phase).toBe('delivered')
    expect(store.get(second.key).phase).toBe('delivered')
    store.close()
  })
})
