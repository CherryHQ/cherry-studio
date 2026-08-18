import { loggerService } from '@logger'
import { type ChannelAdapter, sanitizeChannelOutput } from '@main/ai/channels'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')
const INCOMPLETE_CITATION_MARKER_PATTERN = /[ \t]?\[(?:c(?:i(?:t(?:e(?::[\w-]*)?)?)?)?)?$/
const DELIVERY_TIMEOUT_MS = 15_000
const DELIVERY_RETRY_DELAY_MS = 1_000
const DELIVERY_ATTEMPTS = 2

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Channel delivery timed out after ${DELIVERY_TIMEOUT_MS}ms`)),
      DELIVERY_TIMEOUT_MS
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  readonly terminalDispatch = 'delivery' as const
  private accumulatedText = ''

  constructor(
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

  private async runDelivery(event: 'done' | 'paused' | 'error', deliver: () => Promise<void>): Promise<void> {
    let deliveryError: unknown
    for (let attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt += 1) {
      try {
        await withTimeout(deliver())
        return
      } catch (error) {
        deliveryError = error
        if (attempt < DELIVERY_ATTEMPTS) await delay(DELIVERY_RETRY_DELAY_MS)
      }
    }
    logger.error('Failed to deliver terminal message to channel', {
      channelId: this.adapter.channelId,
      chatId: this.platformChatId,
      event,
      deliveryError
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

  async onDone(result: StreamDoneResult): Promise<void> {
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) {
      logger.warn('ChannelAdapterListener.onDone with empty text', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        status: result.status
      })
      return
    }

    await this.runDelivery('done', async () => {
      // Adapter finalizes its streaming UI first (e.g. close Feishu card).
      const handled = await this.adapter.onStreamComplete(this.platformChatId, text)
      if (!handled) await this.deliver(text)
    })
  }

  // oxlint-disable-next-line no-unused-vars
  async onPaused(_result: StreamPausedResult): Promise<void> {
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) return

    await this.runDelivery('paused', async () => {
      const handled = await this.adapter.onStreamComplete(this.platformChatId, text)
      if (!handled) await this.deliver(text + '\n\n_(stopped)_')
    })
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (this.suppressErrorMessage) return
    await this.runDelivery('error', async () => {
      await this.deliver(`Error: ${result.error.message ?? 'Unknown error'}`)
    })
  }

  isAlive(): boolean {
    return this.adapter.connected
  }
}
