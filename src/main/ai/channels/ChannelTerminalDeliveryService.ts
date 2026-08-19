import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import type { ChannelDeliveryRequest } from './ChannelManager'

const logger = loggerService.withContext('ChannelTerminalDeliveryService')

const TERMINAL_DELIVERY_DEDUP_LIMIT = 4096
/** Bounded ownership window for one external send. Policy, not an invariant — see C2. */
const TERMINAL_DELIVERY_TIMEOUT_MS = 15_000

/**
 * Owns outbound terminal delivery to IM channels: the per-`(channelId, chatId)` FIFO, delivery-id
 * dedupe, the bounded send, and blocked-channel state.
 *
 * Split out of `ChannelManager` so the lifecycle can express "producers stop, delivery drains,
 * adapters disconnect". While one service owned both the adapter pool and the queue, dependency
 * ordering could not put anything between those two, and stopping it did both at once.
 *
 * Adapter resolution goes through `ChannelManager`, which this service depends on — so a delivery
 * enqueued before a reconnect sends through the adapter that is live at send time.
 */
@Injectable('ChannelTerminalDeliveryService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ChannelManager'])
export class ChannelTerminalDeliveryService extends BaseService {
  private readonly queues = new Map<string, { channelId: string; requests: ChannelDeliveryRequest[] }>()
  private readonly runners = new Map<string, { channelId: string; promise: Promise<void> }>()
  private readonly deliveryIds = new Set<string>()
  private readonly blockedChannelIds = new Set<string>()
  private readonly connectionEpochs = new Map<string, number>()
  private accepting = false

  protected async onReady(): Promise<void> {
    this.accepting = true
    this.blockedChannelIds.clear()
  }

  /** Reverse shutdown: refuse new work, then let what is already queued settle. */
  protected async onStop(): Promise<void> {
    this.close()
    await this.drain()
    this.queues.clear()
    this.runners.clear()
    this.deliveryIds.clear()
    this.blockedChannelIds.clear()
    this.connectionEpochs.clear()
  }

  /** Accepting is enabled on ready; tests and `ChannelManager.start()` re-arm it explicitly. */
  open(): void {
    this.accepting = true
    this.blockedChannelIds.clear()
    this.connectionEpochs.clear()
  }

  /** Stop accepting new work. Queued deliveries still settle — see `drain`. */
  close(): void {
    this.accepting = false
  }

  block(channelId: string): void {
    this.blockedChannelIds.add(channelId)
    this.dropQueued(channelId)
  }

  /** Only a newer successful connection epoch reopens a channel — never a timeout on its own. */
  reopen(channelId: string, connectionEpoch: number): void {
    const currentEpoch = this.connectionEpochs.get(channelId) ?? 0
    if (connectionEpoch <= currentEpoch) return
    this.connectionEpochs.set(channelId, connectionEpoch)
    this.blockedChannelIds.delete(channelId)
  }

  isBlocked(channelId: string): boolean {
    return this.blockedChannelIds.has(channelId)
  }

  /** Settle queued work, optionally narrowed to specific channels. */
  async drain(channelIds?: ReadonlySet<string>): Promise<void> {
    const pending = [...this.runners.values()]
      .filter(({ channelId }) => !channelIds || channelIds.has(channelId))
      .map(({ promise }) => promise)
    if (pending.length > 0) await Promise.allSettled(pending)
  }

  enqueue(request: ChannelDeliveryRequest): boolean {
    if (!this.accepting || this.blockedChannelIds.has(request.channelId)) {
      logger.warn('Rejected terminal channel delivery: channel is stopping or blocked', {
        deliveryId: request.id,
        channelId: request.channelId,
        chatId: request.chatId,
        event: request.event
      })
      return false
    }
    if (this.deliveryIds.has(request.id)) {
      logger.warn('Ignored duplicate terminal channel delivery', {
        deliveryId: request.id,
        channelId: request.channelId,
        chatId: request.chatId,
        event: request.event
      })
      return false
    }

    this.deliveryIds.add(request.id)
    if (this.deliveryIds.size > TERMINAL_DELIVERY_DEDUP_LIMIT) {
      const oldestId = this.deliveryIds.values().next().value
      if (oldestId) this.deliveryIds.delete(oldestId)
    }

    const key = `${request.channelId}\0${request.chatId}`
    const queue = this.queues.get(key) ?? { channelId: request.channelId, requests: [] }
    queue.requests.push(request)
    this.queues.set(key, queue)
    if (!this.runners.has(key)) this.startRunner(key, queue)
    return true
  }

  private startRunner(key: string, queue: { channelId: string; requests: ChannelDeliveryRequest[] }): void {
    const runner = this.runQueue(key, queue)
    this.runners.set(key, { channelId: queue.channelId, promise: runner })
    const cleanup = () => {
      if (this.runners.get(key)?.promise !== runner) return
      this.runners.delete(key)
      if (queue.requests.length === 0) {
        if (this.queues.get(key) === queue) this.queues.delete(key)
        return
      }
      this.startRunner(key, queue)
    }
    runner.then(cleanup, cleanup)
  }

  private async runQueue(key: string, queue: { channelId: string; requests: ChannelDeliveryRequest[] }): Promise<void> {
    while (this.queues.get(key) === queue) {
      const request = queue.requests.shift()
      if (!request) return
      if (this.blockedChannelIds.has(request.channelId)) {
        this.logSkipped(request)
        continue
      }
      try {
        await this.send(request)
      } catch (error) {
        logger.error('Failed to deliver terminal message to channel', {
          deliveryId: request.id,
          channelId: request.channelId,
          chatId: request.chatId,
          event: request.event,
          error
        })
      }
    }
  }

  private dropQueued(channelId: string): void {
    for (const queue of this.queues.values()) {
      if (queue.channelId !== channelId) continue
      for (const request of queue.requests.splice(0)) this.logSkipped(request)
    }
  }

  private logSkipped(request: ChannelDeliveryRequest): void {
    logger.warn('Skipped queued terminal channel delivery: channel is blocked', {
      deliveryId: request.id,
      channelId: request.channelId,
      chatId: request.chatId,
      event: request.event
    })
  }

  /** Resolve the adapter now, not at enqueue time, and perform the one bounded send. */
  private async send(request: ChannelDeliveryRequest): Promise<void> {
    const adapter = application.get('ChannelManager').getConnectedAdapter(request.channelId)
    if (!adapter) {
      logger.warn('Dropped terminal channel delivery: adapter is gone', {
        deliveryId: request.id,
        channelId: request.channelId,
        chatId: request.chatId
      })
      return
    }

    const controller = new AbortController()
    const attempt = async (): Promise<void> => {
      if (
        request.finalizeStream &&
        (await adapter.onStreamComplete(request.chatId, request.text, request.responseOptions))
      ) {
        return
      }
      const text = request.fallbackText ?? request.text
      await adapter.sendMessage(request.chatId, text, { ...request.responseOptions, signal: controller.signal })
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), TERMINAL_DELIVERY_TIMEOUT_MS)
    })
    try {
      // C2: an adapter whose transport ignores the signal can still hang forever; the timeout ends
      // *our* ownership regardless, releasing the FIFO behind it. No retry — a timed-out send may
      // well have been delivered, so retrying risks a duplicate the user sees.
      const outcome = await Promise.race([attempt().then(() => 'sent' as const), timeout])
      if (outcome !== 'timed-out') return
      controller.abort()
      this.block(request.channelId)
      logger.error('Terminal channel delivery timed out; blocking channel without retry', {
        deliveryId: request.id,
        channelId: request.channelId,
        chatId: request.chatId,
        timeoutMs: TERMINAL_DELIVERY_TIMEOUT_MS
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
