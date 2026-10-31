import { loggerService } from '@logger'
import { type ChannelAdapter, sanitizeChannelOutput, type SendMessageOptions } from '@main/ai/channels'
import { t } from '@main/i18n'
import type { CherryUIMessage } from '@shared/data/types/message'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')
const INCOMPLETE_CITATION_MARKER_PATTERN = /[ \t]?\[(?:c(?:i(?:t(?:e(?::[\w-]*)?)?)?)?)?$/

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  private accumulatedText = ''
  private settled = false

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

  /** Deliver a final message using the inbound message's response context. */
  private deliver(text: string): Promise<void> {
    return this.adapter.sendMessage(this.platformChatId, text, this.responseOptions)
  }

  private updateStream(text: string): Promise<void> {
    return this.adapter.onTextUpdate(this.platformChatId, text, this.responseOptions)
  }

  private completeStream(text: string, status: 'success' | 'paused'): Promise<boolean> {
    return this.adapter.onStreamComplete(this.platformChatId, text, this.responseOptions, { status })
  }

  onChunk(): void {}

  onMessage(message: CherryUIMessage): void {
    if (this.settled) return
    this.accumulatedText = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
    const { text } = sanitizeChannelOutput(this.accumulatedText)
    void this.updateStream(text.replace(INCOMPLETE_CITATION_MARKER_PATTERN, '')).catch(() => {})
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    await this.finish(result.status, result.finalMessage)
  }

  async onPaused(result: StreamPausedResult): Promise<void> {
    await this.finish('paused', result.finalMessage)
  }

  private async finish(status: 'success' | 'paused', message?: CherryUIMessage): Promise<void> {
    if (this.settled) return
    this.settled = true
    if (message)
      this.accumulatedText = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()

    try {
      const handled = await this.completeStream(text, status)
      if (!handled && text) {
        await this.deliver(status === 'paused' ? `${text}\n\n_(${t('common.channel_stopped')})_` : text)
      }
    } catch (err) {
      logger.error('Failed to deliver terminal message to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
    }
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (this.settled) return
    this.settled = true
    try {
      const error = sanitizeChannelOutput(result.error.message ?? t('common.channel_message_processing_error')).text
      const handled = await this.adapter.onStreamError(this.platformChatId, error, this.responseOptions, {
        suppressDelivery: this.suppressErrorMessage
      })
      if (!handled && !this.suppressErrorMessage) {
        await this.deliver(t('common.channel_error', { error }))
      }
    } catch (err) {
      logger.error('Failed to deliver error to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
    }
  }

  isAlive(): boolean {
    return this.adapter.isStreamListenerAlive()
  }
}
