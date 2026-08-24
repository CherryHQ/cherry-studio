import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { type ChannelAdapter, ChannelStreamCompletionResult } from './ChannelAdapter'
import type { ChannelDeliveryRequest, ChannelLiveUpdateRequest } from './ChannelManager'

const logger = loggerService.withContext('ChannelDeliveryService')

const TERMINAL_DELIVERY_DEDUP_LIMIT = 4096
/** Bounded ownership window for one external send. Policy, not an invariant — see C2. */
const TERMINAL_DELIVERY_TIMEOUT_MS = 15_000

export enum ChannelConnectionEvent {
  ReplacementStarted = 'replacement-started',
  ConnectionLost = 'connection-lost',
  Connected = 'connected',
  DeliveryTimedOut = 'delivery-timed-out'
}

enum TerminalDeliveryStage {
  Claimed = 'claimed',
  Finalizing = 'finalizing',
  Sending = 'sending'
}

enum TerminalDeliveryResult {
  Complete = 'complete',
  RetryWhenConnected = 'retry-when-connected',
  Unknown = 'unknown'
}

interface TerminalDeliveryAttempt {
  deliveryId: string
  channelId: string
  adapter: ChannelAdapter
  epoch: number
  controller: AbortController
  stage: TerminalDeliveryStage
}

interface TerminalDeliveryQueue {
  channelId: string
  requests: ChannelDeliveryRequest[]
  waitingForConnection: boolean
}

/**
 * Owns generated-result delivery to IM channels: live updates, terminal FIFO/dedupe, bounded sends,
 * and blocked-channel state.
 *
 * Split out of `ChannelManager` so the lifecycle can express "producers stop, delivery drains,
 * adapters disconnect". While one service owned both the adapter pool and the queue, dependency
 * ordering could not put anything between those two, and stopping it did both at once.
 *
 * Adapter resolution goes through `ChannelManager`, which this service depends on — so a delivery
 * enqueued before a reconnect sends through the adapter that is live at send time.
 */
@Injectable('ChannelDeliveryService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ChannelManager'])
export class ChannelDeliveryService extends BaseService {
  private readonly queues = new Map<string, TerminalDeliveryQueue>()
  private readonly runners = new Map<string, { channelId: string; promise: Promise<void> }>()
  private readonly deliveryIds = new Set<string>()
  private readonly blockedChannelIds = new Set<string>()
  private readonly frozenChannelIds = new Set<string>()
  /** Consumer-side stale fence copied from ChannelManager; this service never generates epochs. */
  private readonly connectionEpochs = new Map<string, number>()
  private readonly liveEpochControllers = new Map<string, AbortController>()
  private readonly terminalAttempts = new Map<string, TerminalDeliveryAttempt>()
  private accepting = false

  protected async onReady(): Promise<void> {
    this.accepting = true
    this.blockedChannelIds.clear()
    this.frozenChannelIds.clear()
  }

  /** Reverse shutdown: refuse new work, then let what is already queued settle. */
  protected async onStop(): Promise<void> {
    this.close()
    await this.drain()
    this.queues.clear()
    this.runners.clear()
    this.deliveryIds.clear()
    this.blockedChannelIds.clear()
    this.frozenChannelIds.clear()
    this.connectionEpochs.clear()
    for (const controller of this.liveEpochControllers.values()) controller.abort('channel-delivery-stop')
    this.liveEpochControllers.clear()
    for (const attempt of this.terminalAttempts.values()) attempt.controller.abort('channel-delivery-stop')
    this.terminalAttempts.clear()
  }

  /** Accepting is enabled on ready; tests and `ChannelManager.start()` re-arm it explicitly. */
  open(): void {
    this.accepting = true
    this.blockedChannelIds.clear()
    this.frozenChannelIds.clear()
    this.connectionEpochs.clear()
    for (const controller of this.liveEpochControllers.values()) controller.abort('channel-delivery-reset')
    this.liveEpochControllers.clear()
  }

  /** Stop accepting new work. Queued deliveries still settle — see `drain`. */
  close(): void {
    this.accepting = false
    for (const controller of this.liveEpochControllers.values()) controller.abort('channel-delivery-close')
    this.liveEpochControllers.clear()
  }

  replacementStarted(channelId: string): void {
    this.frozenChannelIds.add(channelId)
  }

  connectionLost(channelId: string, connectionEpoch?: number): void {
    if (connectionEpoch !== undefined && this.connectionEpochs.get(channelId) !== connectionEpoch) return
    this.connectionEpochs.delete(channelId)
    this.abortLiveEpochs(channelId, ChannelConnectionEvent.ConnectionLost)
    for (const attempt of this.terminalAttempts.values()) {
      if (attempt.channelId === channelId) attempt.controller.abort(ChannelConnectionEvent.ConnectionLost)
    }
    for (const queue of this.queues.values()) {
      if (queue.channelId === channelId) queue.waitingForConnection = true
    }
  }

  /** Only a newer successful connection epoch reopens a channel — never a timeout on its own. */
  connected(channelId: string, connectionEpoch: number): void {
    const currentEpoch = this.connectionEpochs.get(channelId) ?? 0
    if (connectionEpoch <= currentEpoch) return
    this.connectionEpochs.set(channelId, connectionEpoch)
    this.abortLiveEpochs(channelId, 'connection-replaced')
    this.liveEpochControllers.set(`${channelId}\0${connectionEpoch}`, new AbortController())
    this.blockedChannelIds.delete(channelId)
    this.frozenChannelIds.delete(channelId)
    for (const [key, queue] of this.queues) {
      if (queue.channelId !== channelId) continue
      queue.waitingForConnection = false
      if (!this.runners.has(key) && queue.requests.length > 0) this.startRunner(key, queue)
    }
  }

  isBlocked(channelId: string): boolean {
    return this.blockedChannelIds.has(channelId)
  }

  isActive(): boolean {
    return this.accepting
  }

  updateLive(request: ChannelLiveUpdateRequest): boolean {
    if (
      !this.accepting ||
      this.blockedChannelIds.has(request.channelId) ||
      this.frozenChannelIds.has(request.channelId)
    )
      return false
    const resolved = application.get('ChannelManager').resolveConnectedAdapter(request.channelId)
    if (!resolved || this.connectionEpochs.get(request.channelId) !== resolved.epoch) return false
    const key = `${request.channelId}\0${resolved.epoch}`
    const controller = this.liveEpochControllers.get(key)
    if (!controller || controller.signal.aborted) return false
    void resolved.adapter
      .onTextUpdate(request.chatId, request.text, {
        ...request.responseOptions,
        signal: controller.signal
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        logger.warn('Live channel update failed', {
          channelId: request.channelId,
          chatId: request.chatId,
          executionId: request.executionId,
          error
        })
      })
    return true
  }

  /** Settle queued work, optionally narrowed to specific channels. */
  async drain(channelIds?: ReadonlySet<string>): Promise<void> {
    const pending = [...this.runners.values()]
      .filter(({ channelId }) => !channelIds || channelIds.has(channelId))
      .map(({ promise }) => promise)
    if (pending.length > 0) await Promise.allSettled(pending)
  }

  enqueueTerminal(request: ChannelDeliveryRequest): boolean {
    if (
      !this.accepting ||
      this.blockedChannelIds.has(request.channelId) ||
      this.frozenChannelIds.has(request.channelId)
    ) {
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
    const queue = this.queues.get(key) ?? {
      channelId: request.channelId,
      requests: [],
      waitingForConnection: false
    }
    queue.requests.push(request)
    this.queues.set(key, queue)
    if (!this.runners.has(key)) this.startRunner(key, queue)
    return true
  }

  private startRunner(key: string, queue: TerminalDeliveryQueue): void {
    const runner = this.runQueue(key, queue)
    this.runners.set(key, { channelId: queue.channelId, promise: runner })
    const cleanup = () => {
      if (this.runners.get(key)?.promise !== runner) return
      this.runners.delete(key)
      if (queue.requests.length === 0) {
        if (this.queues.get(key) === queue) this.queues.delete(key)
        return
      }
      if (queue.waitingForConnection) return
      this.startRunner(key, queue)
    }
    runner.then(cleanup, cleanup)
  }

  private async runQueue(key: string, queue: TerminalDeliveryQueue): Promise<void> {
    while (this.queues.get(key) === queue) {
      const request = queue.requests.shift()
      if (!request) return
      if (this.blockedChannelIds.has(request.channelId)) {
        this.logSkipped(request)
        continue
      }
      const result = await this.send(request)
      if (result === TerminalDeliveryResult.RetryWhenConnected) {
        queue.requests.unshift(request)
        queue.waitingForConnection = true
        return
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

  private abortLiveEpochs(channelId: string, reason: string): void {
    for (const [key, controller] of this.liveEpochControllers) {
      if (!key.startsWith(`${channelId}\0`)) continue
      controller.abort(reason)
      this.liveEpochControllers.delete(key)
    }
  }

  private deliveryTimedOut(attempt: TerminalDeliveryAttempt): void {
    this.blockedChannelIds.add(attempt.channelId)
    attempt.controller.abort(ChannelConnectionEvent.DeliveryTimedOut)
    this.abortLiveEpochs(attempt.channelId, ChannelConnectionEvent.DeliveryTimedOut)
    this.dropQueued(attempt.channelId)
  }

  private isCurrentAttempt(attempt: TerminalDeliveryAttempt): boolean {
    if (attempt.controller.signal.aborted || this.connectionEpochs.get(attempt.channelId) !== attempt.epoch)
      return false
    const resolved = application.get('ChannelManager').resolveConnectedAdapter(attempt.channelId)
    return resolved?.adapter === attempt.adapter && resolved.epoch === attempt.epoch
  }

  /** Resolve the adapter now, not at enqueue time, and perform the one bounded send. */
  private async send(request: ChannelDeliveryRequest): Promise<TerminalDeliveryResult> {
    const resolved = application.get('ChannelManager').resolveConnectedAdapter(request.channelId)
    if (!resolved || this.connectionEpochs.get(request.channelId) !== resolved.epoch) {
      return TerminalDeliveryResult.RetryWhenConnected
    }
    const attempt: TerminalDeliveryAttempt = {
      deliveryId: request.id,
      channelId: request.channelId,
      adapter: resolved.adapter,
      epoch: resolved.epoch,
      controller: new AbortController(),
      stage: TerminalDeliveryStage.Claimed
    }
    this.terminalAttempts.set(request.id, attempt)
    const run = async (): Promise<TerminalDeliveryResult> => {
      if (!this.isCurrentAttempt(attempt)) return TerminalDeliveryResult.RetryWhenConnected
      if (request.finalizeStream) {
        attempt.stage = TerminalDeliveryStage.Finalizing
        const finalized = await attempt.adapter.onStreamComplete(request.chatId, request.text, {
          ...request.responseOptions,
          signal: attempt.controller.signal
        })
        if (finalized === ChannelStreamCompletionResult.Delivered) return TerminalDeliveryResult.Complete
        if (!this.isCurrentAttempt(attempt)) return TerminalDeliveryResult.RetryWhenConnected
      }
      if (!this.isCurrentAttempt(attempt)) return TerminalDeliveryResult.RetryWhenConnected
      const text = request.fallbackText ?? request.text
      attempt.stage = TerminalDeliveryStage.Sending
      await attempt.adapter.sendMessage(request.chatId, text, {
        ...request.responseOptions,
        signal: attempt.controller.signal
      })
      return TerminalDeliveryResult.Complete
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timed-out'>((resolve) => {
      timer = setTimeout(() => resolve('timed-out'), TERMINAL_DELIVERY_TIMEOUT_MS)
    })
    try {
      // C2: an adapter whose transport ignores the signal can still hang forever; the timeout ends
      // *our* ownership regardless, releasing the FIFO behind it. No retry — a timed-out send may
      // well have been delivered, so retrying risks a duplicate the user sees.
      const outcome = await Promise.race([run(), timeout])
      if (outcome !== 'timed-out') return outcome
      this.deliveryTimedOut(attempt)
      logger.error('Terminal channel delivery timed out; blocking channel without retry', {
        deliveryId: request.id,
        channelId: request.channelId,
        chatId: request.chatId,
        timeoutMs: TERMINAL_DELIVERY_TIMEOUT_MS
      })
      return TerminalDeliveryResult.Unknown
    } catch (error) {
      logger.error('Failed to deliver terminal message to channel; external result is unknown', {
        deliveryId: request.id,
        channelId: request.channelId,
        chatId: request.chatId,
        event: request.event,
        error
      })
      return TerminalDeliveryResult.Unknown
    } finally {
      if (timer) clearTimeout(timer)
      if (this.terminalAttempts.get(request.id) === attempt) this.terminalAttempts.delete(request.id)
    }
  }
}
