import type { FleetClient, SlackExecution } from '@fleet/client'
import { DeliveryStore, type Delivery } from './delivery-store.js'
import { fleetIdempotencyKey, type SlackMention } from './mention.js'
import {
  renderProgress,
  splitSlackAnswer,
  type SlackThreadPublisher,
  type ThreadTarget,
} from './slack-thread.js'
import { questionWithSlackContext, type SlackContextReader } from './thread-context.js'

export class DeliveryService {
  private processing: Promise<void> | null = null
  constructor(
    private readonly store: DeliveryStore,
    private readonly fleet: FleetClient,
    private readonly slack: SlackThreadPublisher,
    private readonly context: SlackContextReader,
    private readonly execution: SlackExecution,
  ) {}

  accept(mention: SlackMention): void {
    this.store.accept(mention)
    this.wake()
  }

  wake(): void {
    if (this.processing) return
    this.processing = this.drain().finally(() => {
      this.processing = null
      if (this.store.pending().length > 0) this.wake()
    })
  }

  async idle(): Promise<void> {
    while (this.processing) await this.processing
  }

  private async drain() {
    for (const delivery of this.store.pending()) {
      try {
        await this.process(this.store.get(delivery.key))
      } catch {
        await this.publishFailure(this.store.get(delivery.key))
      }
    }
  }

  private target(delivery: Delivery): ThreadTarget {
    return { channelId: delivery.mention.channelId, threadTs: delivery.mention.threadTs }
  }

  private async process(delivery: Delivery) {
    if (delivery.phase === 'terminal-pending') {
      await this.deliverTerminal(delivery)
      return
    }
    if (delivery.phase === 'queued') {
      if (delivery.contextText === null) {
        const contextText = await this.context.read(delivery.mention)
        this.store.contextLoaded(delivery.key, contextText)
        delivery = this.store.get(delivery.key)
      }
      const snapshot = await this.fleet.createRun({
        question: questionWithSlackContext(delivery.mention, delivery.contextText ?? ''),
        idempotencyKey: fleetIdempotencyKey(delivery.mention),
        execution: this.execution,
      })
      this.store.following(delivery.key, snapshot.id)
      delivery = this.store.get(delivery.key)
    }
    if (delivery.phase !== 'following') return
    let lastStatusText: string | null = null
    let lastStatusAt = 0
    for await (const projection of this.fleet.follow(delivery.runId, {
      after: delivery.cursor,
      signal: new AbortController().signal,
    })) {
      delivery = this.store.get(delivery.key)
      if (delivery.phase !== 'following') return
      const progressText = renderProgress(projection.snapshot)
      const statusAlreadyPublished = delivery.statusTs !== null
      delivery = await this.ensureStatus(delivery, progressText)
      if (!statusAlreadyPublished) {
        lastStatusText = progressText
        lastStatusAt = Date.now()
      }
      if (projection.terminal) {
        const terminalText = projection.snapshot.status === 'completed'
          ? projection.snapshot.finalAnswer ?? 'Fleet completed without a written answer.'
          : 'Fleet could not complete this research run. Please try again.'
        this.store.terminalPending(delivery.key, projection.cursor, terminalText)
        await this.deliverTerminal(this.store.get(delivery.key))
        return
      }
      if (progressText !== lastStatusText && Date.now() - lastStatusAt >= 1_500) {
        await this.slack.updateStatus({ ...this.target(delivery), statusTs: delivery.statusTs! }, progressText)
        lastStatusText = progressText
        lastStatusAt = Date.now()
      }
      this.store.advance(delivery.key, projection.cursor)
    }
  }

  private async ensureStatus(delivery: Extract<Delivery, { phase: 'following' }>, progressText: string) {
    if (delivery.statusTs) return delivery
    const statusTs = await this.slack.publishStatus(this.target(delivery), progressText)
    this.store.statusPublished(delivery.key, statusTs)
    return this.store.get(delivery.key) as Extract<Delivery, { phase: 'following' }>
  }

  private async deliverTerminal(delivery: Delivery) {
    if (delivery.phase !== 'terminal-pending') return
    const chunks = splitSlackAnswer(delivery.terminalText)
    await this.slack.updateStatus({ ...this.target(delivery), statusTs: delivery.statusTs }, chunks[0])
    await this.slack.postAnswerRemainder(this.target(delivery), chunks.slice(1))
    this.store.delivered(delivery.key)
  }

  private async publishFailure(delivery: Delivery) {
    const text = 'Fleet could not start this research run. Please try again.'
    if (delivery.phase === 'delivered' || delivery.phase === 'failed') return
    if (delivery.statusTs) {
      await this.slack.updateStatus({ ...this.target(delivery), statusTs: delivery.statusTs }, text).catch(() => undefined)
    } else {
      await this.slack.publishStatus(this.target(delivery), text).catch(() => undefined)
    }
    this.store.failed(delivery.key, text)
  }
}
