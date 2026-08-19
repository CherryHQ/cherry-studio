import { loggerService } from '@logger'
import {
  type ChannelAdapter,
  type ChannelTerminalDeliveryOwner,
  sanitizeChannelOutput,
  type SendMessageOptions
} from '@main/ai/channels'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')
const INCOMPLETE_CITATION_MARKER_PATTERN = /[ \t]?\[(?:c(?:i(?:t(?:e(?::[\w-]*)?)?)?)?)?$/
let nextDeliveryListenerId = 0

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  private readonly deliveryListenerId = ++nextDeliveryListenerId
  private accumulatedText = ''
  private terminalDeliveryQueued = false
  /** Attempt the accumulator and one-shot flag currently belong to; undefined = unbound. */
  private boundAttemptId: number | undefined

  /**
   * C1: accumulator, one-shot flag and delivery id are per attempt, but this listener outlives an
   * Agent continuation (A1 → A2). Rebinding on a new attempt is what stops A1's text from being
   * delivered as A2's answer — and, more damagingly, stops A1's spent one-shot flag from
   * suppressing A2's delivery entirely.
   */
  private bindTo(attemptId: number | undefined): void {
    if (attemptId === undefined || attemptId === this.boundAttemptId) return
    // Adopting an identity for text already accumulated unscoped is not a turn change: chunks may
    // arrive without an attempt id and only the terminal names it. Reset only on a real switch.
    const isNewAttempt = this.boundAttemptId !== undefined
    this.boundAttemptId = attemptId
    if (!isNewAttempt) return
    this.accumulatedText = ''
    this.terminalDeliveryQueued = false
  }

  constructor(
    private readonly deliveryOwner: ChannelTerminalDeliveryOwner,
    private readonly adapter: ChannelAdapter,
    private readonly platformChatId: string,
    /**
     * Skip the generic `Error: …` channel message on failure. Scheduled-task runs
     * deliver a richer `[Task failed] …` summary themselves (see `runAgentTask`), so
     * leaving this on would double-notify every subscribed channel.
     */
    private readonly suppressErrorMessage = false,
    /** Response context for the inbound message, including thread placement where supported. */
    private readonly responseOptions?: SendMessageOptions
  ) {
    const responseKey = this.responseOptions?.replyToMessageId ?? 'unthreaded'
    this.id = `channel:${adapter.channelId}:${this.platformChatId}:${responseKey}`
  }

  private updateStream(text: string): Promise<void> {
    return this.adapter.onTextUpdate(this.platformChatId, text, this.responseOptions)
  }

  /** Submit stable data, never a closure — the queue must not retain this listener (C3).
   *  The inbound response context rides along so the send resolves a live adapter (C2). */
  private enqueueDelivery(
    event: 'done' | 'paused' | 'error',
    attemptId: number | undefined,
    text: string,
    opts: { finalizeStream?: boolean; fallbackText?: string } = {}
  ): void {
    if (this.terminalDeliveryQueued) return
    this.terminalDeliveryQueued = true
    this.deliveryOwner.enqueueTerminalDelivery({
      id: `stream:${this.deliveryListenerId}:${event}:${attemptId ?? 'unscoped'}`,
      channelId: this.adapter.channelId,
      chatId: this.platformChatId,
      event,
      text,
      ...(this.responseOptions !== undefined ? { responseOptions: this.responseOptions } : {}),
      ...opts
    })
  }

  // oxlint-disable-next-line no-unused-vars
  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId, _anchorMessageId?: string, attemptId?: number): void {
    this.bindTo(attemptId)
    if (chunk.type === 'text-delta' && chunk.delta) {
      this.accumulatedText += chunk.delta
      // Best-effort streaming update; adapter chooses to throttle. Sanitize here — this is
      // the live delivery path that reaches the IM platform, so secrets (keys/tokens) must
      // be redacted before they leave.
      const { text } = sanitizeChannelOutput(this.accumulatedText)
      const update = this.updateStream(text.replace(INCOMPLETE_CITATION_MARKER_PATTERN, ''))
      void update.catch(() => {})
    }
  }

  onDone(result: StreamDoneResult): void {
    this.bindTo(result.attemptId)
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) {
      logger.warn('ChannelAdapterListener.onDone with empty text', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        status: result.status
      })
      return
    }

    // Adapter finalizes its streaming UI first (e.g. close a Feishu card); the delivery service
    // owns that ordering now, plus the bounded send and its error handling.
    this.enqueueDelivery('done', result.attemptId, text, { finalizeStream: true })
  }

  onPaused(result: StreamPausedResult): void {
    this.bindTo(result.attemptId)
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) return

    this.enqueueDelivery('paused', result.attemptId, text, {
      finalizeStream: true,
      fallbackText: `${text}\n\n_(stopped)_`
    })
  }

  onError(result: StreamErrorResult): void {
    this.bindTo(result.attemptId)
    if (this.suppressErrorMessage) return
    this.enqueueDelivery('error', result.attemptId, `Error: ${result.error.message ?? 'Unknown error'}`)
  }

  isAlive(): boolean {
    return this.adapter.connected
  }
}
