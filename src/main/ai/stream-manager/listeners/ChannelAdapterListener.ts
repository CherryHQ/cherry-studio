import { loggerService } from '@logger'
import type { ChannelAdapter } from '@main/services/agents/services/channels/ChannelAdapter'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')

/**
 * Sends stream results to an IM channel (Discord / Slack / Feishu / Telegram / etc).
 *
 * Listener id is `channel:${channelId}:${platformChatId}`.
 */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  private accumulatedText = ''

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly platformChatId: string
  ) {
    this.id = `channel:${adapter.channelId}:${this.platformChatId}`
  }

  // oxlint-disable-next-line no-unused-vars
  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId): void {
    // Accumulate text for adapters that don't support streaming updates.
    // Adapters with streaming support (e.g. Feishu card editing) get updates
    // via onTextUpdate — called here on every text-delta.
    if (chunk.type === 'text-delta' && chunk.delta) {
      this.accumulatedText += chunk.delta
      // Best-effort streaming update — adapter decides whether to throttle/flush
      void this.adapter.onTextUpdate(this.platformChatId, this.accumulatedText).catch(() => {})
    }
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    const text = this.accumulatedText.trim()
    if (!text) {
      logger.warn('ChannelAdapterListener.onDone with empty text', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        status: result.status
      })
      return
    }

    try {
      // Let adapter finalize its streaming UI first (e.g. close Feishu card)
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
    const text = this.accumulatedText.trim()
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
