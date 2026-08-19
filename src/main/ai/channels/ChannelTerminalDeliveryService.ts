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
  private readonly tails = new Map<string, Promise<void>>()
  private readonly inFlight = new Map<Promise<void>, ChannelDeliveryRequest>()
  private readonly deliveryIds = new Set<string>()
  private readonly blockedChannelIds = new Set<string>()
  private accepting = false

  protected async onReady(): Promise<void> {
    this.accepting = true
    this.blockedChannelIds.clear()
  }

  /** Reverse shutdown: refuse new work, then let what is already queued settle. */
  protected async onStop(): Promise<void> {
    this.close()
    await this.drain()
    this.tails.clear()
    this.inFlight.clear()
    this.deliveryIds.clear()
    this.blockedChannelIds.clear()
  }

  /** Accepting is enabled on ready; tests and `ChannelManager.start()` re-arm it explicitly. */
  open(): void {
    this.accepting = true
    this.blockedChannelIds.clear()
  }

  /** Stop accepting new work. Queued deliveries still settle — see `drain`. */
  close(): void {
    this.accepting = false
  }

  block(channelId: string): void {
    this.blockedChannelIds.add(channelId)
  }

  /** Only a successful reconnect reopens a channel — never a timeout on its own. */
  reopen(channelId: string): void {
    this.blockedChannelIds.delete(channelId)
  }

  isBlocked(channelId: string): boolean {
    return this.blockedChannelIds.has(channelId)
  }

  /** Settle queued work, optionally narrowed to specific channels. */
  async drain(channelIds?: ReadonlySet<string>): Promise<void> {
    const pending = [...this.inFlight.entries()]
      .filter(([, request]) => !channelIds || channelIds.has(request.channelId))
      .map(([promise]) => promise)
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
    const previous = this.tails.get(key) ?? Promise.resolve()
    const queued = previous.then(async () => {
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
    })

    this.tails.set(key, queued)
    this.inFlight.set(queued, request)
    const cleanup = () => {
      this.inFlight.delete(queued)
      if (this.tails.get(key) === queued) this.tails.delete(key)
    }
    queued.then(cleanup, cleanup)
    return true
  }

  /** Resolve the adapter now, not at enqueue time, and perform the one bounded send. */
  private async send(request: ChannelDeliveryRequest): Promise<void> {
    const adapter = application.get('ChannelManager').getAdapter(request.channelId)
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
      this.blockedChannelIds.add(request.channelId)
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
