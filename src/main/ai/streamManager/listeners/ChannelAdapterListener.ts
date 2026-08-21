import { loggerService } from '@logger'
import {
  ChannelDeliveryEvent,
  type ChannelDeliveryOwner,
  sanitizeChannelOutput,
  type SendMessageOptions
} from '@main/ai/channels'
import type { ConversationExecutionId } from '@shared/ai/conversation'
import type { UIMessageChunk } from 'ai'

import {
  type ConversationStreamIdentity,
  type StreamDoneResult,
  type StreamErrorResult,
  type StreamListener,
  StreamListenerAudience,
  type StreamPausedResult
} from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')
const INCOMPLETE_CITATION_MARKER_PATTERN = /[ \t]?\[(?:c(?:i(?:t(?:e(?::[\w-]*)?)?)?)?)?$/
let nextDeliveryListenerId = 0

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  readonly audience = StreamListenerAudience.ExternalDelivery
  private readonly deliveryListenerId = ++nextDeliveryListenerId
  private accumulatedText = ''
  private terminalDeliveryQueued = false

  constructor(
    private readonly deliveryOwner: ChannelDeliveryOwner,
    private readonly channelId: string,
    private readonly platformChatId: string,
    /**
     * Skip the generic `Error: …` channel message on failure. Scheduled-task runs
     * deliver a richer `[Task failed] …` summary themselves (see `runAgentTask`), so
     * leaving this on would double-notify every subscribed channel.
     */
    private readonly suppressErrorMessage = false,
    /** Response context for the inbound message, including thread placement where supported. */
    private readonly responseOptions?: SendMessageOptions,
    private readonly executionId?: ConversationExecutionId
  ) {
    const responseKey = this.responseOptions?.replyToMessageId ?? 'unthreaded'
    this.id = `channel:${channelId}:${this.platformChatId}:${responseKey}:${executionId ?? 'template'}`
  }

  createForExecution(executionId: ConversationExecutionId): StreamListener {
    return new ChannelAdapterListener(
      this.deliveryOwner,
      this.channelId,
      this.platformChatId,
      this.suppressErrorMessage,
      this.responseOptions,
      executionId
    )
  }

  private owns(executionId: ConversationExecutionId | undefined): boolean {
    return this.executionId === undefined || executionId === this.executionId
  }

  private updateStream(text: string, executionId: ConversationExecutionId | undefined): void {
    this.deliveryOwner.updateLive({
      channelId: this.channelId,
      chatId: this.platformChatId,
      executionId,
      text,
      ...(this.responseOptions ? { responseOptions: this.responseOptions } : {})
    })
  }

  /** Submit stable data, never a closure — the queue must not retain this listener (C3).
   *  The inbound response context rides along so the send resolves a live adapter (C2). */
  private enqueueDelivery(
    event: ChannelDeliveryEvent,
    executionId: ConversationExecutionId | undefined,
    text: string,
    opts: { finalizeStream?: boolean; fallbackText?: string } = {}
  ): void {
    if (this.terminalDeliveryQueued) return
    this.terminalDeliveryQueued = true
    this.deliveryOwner.enqueueTerminal({
      id: `stream:${this.deliveryListenerId}:${event}:${executionId ?? 'unscoped'}`,
      channelId: this.channelId,
      chatId: this.platformChatId,
      event,
      text,
      ...(this.responseOptions !== undefined ? { responseOptions: this.responseOptions } : {}),
      ...opts
    })
  }

  onChunk(chunk: UIMessageChunk, identity?: ConversationStreamIdentity): void {
    if (!this.owns(identity?.executionId)) return
    if (chunk.type === 'text-delta' && chunk.delta) {
      this.accumulatedText += chunk.delta
      // Best-effort streaming update; adapter chooses to throttle. Sanitize here — this is
      // the live delivery path that reaches the IM platform, so secrets (keys/tokens) must
      // be redacted before they leave.
      const { text } = sanitizeChannelOutput(this.accumulatedText)
      this.updateStream(text.replace(INCOMPLETE_CITATION_MARKER_PATTERN, ''), identity?.executionId)
    }
  }

  onDone(result: StreamDoneResult): void {
    if (!this.owns(result.executionId)) return
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) {
      logger.warn('ChannelAdapterListener.onDone with empty text', {
        channelId: this.channelId,
        chatId: this.platformChatId,
        status: result.status
      })
      return
    }

    // Adapter finalizes its streaming UI first (e.g. close a Feishu card); the delivery service
    // owns that ordering now, plus the bounded send and its error handling.
    this.enqueueDelivery(ChannelDeliveryEvent.Done, result.executionId, text, { finalizeStream: true })
  }

  onPaused(result: StreamPausedResult): void {
    if (!this.owns(result.executionId)) return
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) return

    this.enqueueDelivery(ChannelDeliveryEvent.Paused, result.executionId, text, {
      finalizeStream: true,
      fallbackText: `${text}\n\n_(stopped)_`
    })
  }

  onError(result: StreamErrorResult): void {
    if (!this.owns(result.executionId)) return
    if (this.suppressErrorMessage) return
    this.enqueueDelivery(
      ChannelDeliveryEvent.Error,
      result.executionId,
      `Error: ${result.error.message ?? 'Unknown error'}`
    )
  }

  isAlive(): boolean {
    return this.deliveryOwner.isActive()
  }
}
