import { loggerService } from '@logger'
import type { ChannelAdapter } from '@main/ai/channels/ChannelAdapter'
import { sanitizeChannelOutput } from '@main/ai/channels/security'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  private accumulatedText = ''

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly platformChatId: string,
    /**
     * Skip the generic `Error: …` channel message on failure. Scheduled-task runs
     * deliver a richer `[Task failed] …` summary themselves (see `runAgentTask`), so
     * leaving this on would double-notify every subscribed channel.
     */
    private readonly suppressErrorMessage = false
  ) {
    this.id = `channel:${adapter.channelId}:${this.platformChatId}`
  }

  // oxlint-disable-next-line no-unused-vars
  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId): void {
    if (chunk.type === 'text-delta' && chunk.delta) {
      this.accumulatedText += chunk.delta
      // Best-effort streaming update; adapter chooses to throttle. Sanitize here — this is
      // the live delivery path that reaches the IM platform, so secrets (keys/tokens) must
      // be redacted before they leave.
      const { text } = sanitizeChannelOutput(this.accumulatedText)
      void this.adapter.onTextUpdate(this.platformChatId, text).catch(() => {})
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

    try {
      // Adapter finalizes its streaming UI first (e.g. close Feishu card).
      const handled = await this.adapter.onStreamComplete(this.platformChatId, text)
      if (!handled) {
        await this.adapter.sendMessage(this.platformChatId, text)
      }
    } catch (err) {
      logger.error('Failed to deliver message to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
    }
  }

  // oxlint-disable-next-line no-unused-vars
  async onPaused(_result: StreamPausedResult): Promise<void> {
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()
    if (!text) return

    try {
      const handled = await this.adapter.onStreamComplete(this.platformChatId, text)
      if (!handled) {
        await this.adapter.sendMessage(this.platformChatId, text + '\n\n_(stopped)_')
      }
    } catch (err) {
      logger.error('Failed to deliver paused message to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
    }
  }

  async onError(result: StreamErrorResult): Promise<void> {
    if (this.suppressErrorMessage) return
    try {
      await this.adapter.sendMessage(this.platformChatId, `Error: ${result.error.message ?? 'Unknown error'}`)
    } catch (err) {
      logger.error('Failed to deliver error to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
    }
  }

  isAlive(): boolean {
    return this.adapter.connected
  }
}
