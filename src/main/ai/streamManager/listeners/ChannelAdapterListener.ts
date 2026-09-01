import { loggerService } from '@logger'
import { type ChannelAdapter, sanitizeChannelOutput, type SendMessageOptions } from '@main/ai/channels'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')
const INCOMPLETE_CITATION_MARKER_PATTERN = /[ \t]?\[(?:c(?:i(?:t(?:e(?::[\w-]*)?)?)?)?)?$/

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  private accumulatedText = ''
  private lastDeliveryError: unknown = null
  private deliveryPromise: Promise<void> | null = null
  private resolveDeliverySettled: (() => void) | null = null
  private rejectDeliverySettled: ((e: unknown) => void) | null = null

  get deliveryError(): unknown {
    return this.lastDeliveryError
  }

  async waitForDelivery(): Promise<void> {
    let start = Date.now()
    while (!this.deliveryPromise && Date.now() - start < 300) {
      await new Promise<void>((r) => setTimeout(r, 5))
    }
    if (this.deliveryPromise) return this.deliveryPromise
  }

  constructor(
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

  private createDeliveryTracker(): void {
    this.deliveryPromise = new Promise<void>((resolve, reject) => {
      this.resolveDeliverySettled = resolve
      this.rejectDeliverySettled = reject
    })
  }

  /** Deliver a final message using the inbound message's response context. */
  private deliver(text: string): Promise<void> {
    return this.adapter.sendMessage(this.platformChatId, text, this.responseOptions)
  }

  private updateStream(text: string): Promise<void> {
    return this.adapter.onTextUpdate(this.platformChatId, text, this.responseOptions)
  }

  private completeStream(text: string): Promise<boolean> {
    return this.adapter.onStreamComplete(this.platformChatId, text, this.responseOptions)
  }

  // oxlint-disable-next-line no-unused-vars
  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId): void {
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

  async onDone(result: StreamDoneResult): Promise<void> {
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) {
      logger.warn('ChannelAdapterListener.onDone with empty text', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        status: result.status
      })
      this.createDeliveryTracker()
      this.resolveDeliverySettled?.()
      return
    }

    this.createDeliveryTracker()
    try {
      const handled = await this.completeStream(text)
      if (!handled) {
        await this.deliver(text)
      }
      this.lastDeliveryError = null
      this.resolveDeliverySettled?.()
    } catch (err) {
      this.lastDeliveryError = err
      logger.error('Failed to deliver message to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
      this.rejectDeliverySettled?.(err)
      throw err
    }
  }

  // oxlint-disable-next-line no-unused-vars
  async onPaused(_result: StreamPausedResult): Promise<void> {
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) {
      this.createDeliveryTracker()
      this.resolveDeliverySettled?.()
      return
    }

    this.createDeliveryTracker()
    try {
      const handled = await this.completeStream(text)
      if (!handled) {
        await this.deliver(text + '\n\n_(stopped)_')
      }
      this.lastDeliveryError = null
      this.resolveDeliverySettled?.()
    } catch (err) {
      this.lastDeliveryError = err
      logger.error('Failed to deliver paused message to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
      this.rejectDeliverySettled?.(err)
      throw err
    }
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (this.suppressErrorMessage) {
      this.createDeliveryTracker()
      this.resolveDeliverySettled?.()
      return
    }
    this.createDeliveryTracker()
    try {
      await this.deliver(`Error: ${result.error.message ?? 'Unknown error'}`)
      this.lastDeliveryError = null
      this.resolveDeliverySettled?.()
    } catch (err) {
      this.lastDeliveryError = err
      logger.error('Failed to deliver error to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
      this.rejectDeliverySettled?.(err)
      throw err
    }
  }

  isAlive(): boolean {
    return this.adapter.connected
  }
}
