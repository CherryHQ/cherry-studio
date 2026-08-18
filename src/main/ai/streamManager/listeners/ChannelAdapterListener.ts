import { loggerService } from '@logger'
import { type ChannelAdapter, type ChannelTerminalDeliveryOwner, sanitizeChannelOutput } from '@main/ai/channels'
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
    /** Inbound message id this run answers, so the reply targets it (e.g. QQ passive reply). */
    private readonly replyToMessageId?: string | number
  ) {
    this.id = `channel:${adapter.channelId}:${this.platformChatId}`
  }

  /** Deliver a final message, threading the reply target only when this run has one. */
  private deliver(text: string): Promise<void> {
    return this.replyToMessageId !== undefined
      ? this.adapter.sendMessage(this.platformChatId, text, { replyToMessageId: this.replyToMessageId })
      : this.adapter.sendMessage(this.platformChatId, text)
  }

  private enqueueDelivery(
    event: 'done' | 'paused' | 'error',
    attemptId: number | undefined,
    deliver: () => Promise<void>
  ): void {
    if (this.terminalDeliveryQueued) return
    this.terminalDeliveryQueued = true
    this.deliveryOwner.enqueueTerminalDelivery({
      id: `stream:${this.deliveryListenerId}:${event}:${attemptId ?? 'unscoped'}`,
      channelId: this.adapter.channelId,
      chatId: this.platformChatId,
      event,
      deliver
    })
  }

  // oxlint-disable-next-line no-unused-vars
  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId): void {
    if (chunk.type === 'text-delta' && chunk.delta) {
      this.accumulatedText += chunk.delta
      // Best-effort streaming update; adapter chooses to throttle. Sanitize here — this is
      // the live delivery path that reaches the IM platform, so secrets (keys/tokens) must
      // be redacted before they leave.
      const { text } = sanitizeChannelOutput(this.accumulatedText)
      void this.adapter
        .onTextUpdate(this.platformChatId, text.replace(INCOMPLETE_CITATION_MARKER_PATTERN, ''))
        .catch(() => {})
    }
  }

  onDone(result: StreamDoneResult): void {
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) {
      logger.warn('ChannelAdapterListener.onDone with empty text', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        status: result.status
      })
      return
    }

    this.enqueueDelivery('done', result.attemptId, async () => {
      // Adapter finalizes its streaming UI first (e.g. close Feishu card).
      const handled = await this.adapter.onStreamComplete(this.platformChatId, text)
      if (!handled) await this.deliver(text)
    })
  }

  onPaused(result: StreamPausedResult): void {
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) return

    this.enqueueDelivery('paused', result.attemptId, async () => {
      const handled = await this.adapter.onStreamComplete(this.platformChatId, text)
      if (!handled) await this.deliver(text + '\n\n_(stopped)_')
    })
  }

  onError(result: StreamErrorResult): void {
    if (this.suppressErrorMessage) return
    this.enqueueDelivery('error', result.attemptId, async () => {
      await this.deliver(`Error: ${result.error.message ?? 'Unknown error'}`)
    })
  }

  isAlive(): boolean {
    return this.adapter.connected
  }
}
