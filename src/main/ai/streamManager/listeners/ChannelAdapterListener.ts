import type { UIMessageChunk } from 'ai'

import { loggerService } from '@logger'
import { type ChannelAdapter, sanitizeChannelOutput, type SendMessageOptions } from '@main/ai/channels'
import { t } from '@main/i18n'
import type { UniqueModelId } from '@shared/data/types/model'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')
const INCOMPLETE_CITATION_MARKER_PATTERN = /[ \t]?\[(?:c(?:i(?:t(?:e(?::[\w-]*)?)?)?)?)?$/

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  private accumulatedText = ''
  /**
   * Whether this turn's terminal has been handed to the adapter. Scoped to the turn, not to the
   * listener: a chain-hold gap (`isTopicDone: false`) keeps the topic alive so the next turn
   * arrives on this same listener, and new output re-arms it.
   */
  private delivered = false
  /** Attempt id of the execution whose terminal was last delivered. */
  private deliveredAttemptId?: number

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

  // oxlint-disable-next-line no-unused-vars
  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId): void {
    if (chunk.type === 'text-delta' && chunk.delta) {
      this.accumulatedText += chunk.delta
      // Fresh output owes the channel a delivery — a listener outlives one settle (a chain-hold gap
      // keeps the topic alive so the next turn carries this same listener).
      this.delivered = false
      // Best-effort streaming update; adapter chooses to throttle. Sanitize here — this is
      // the live delivery path that reaches the IM platform, so secrets (keys/tokens) must
      // be redacted before they leave.
      const { text } = sanitizeChannelOutput(this.accumulatedText)
      const update = this.updateStream(text.replace(INCOMPLETE_CITATION_MARKER_PATTERN, ''))
      void update.catch(() => {})
    }
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    await this.finish(result.status, result.isTopicDone, result.attemptId)
  }

  // oxlint-disable-next-line no-unused-vars
  async onPaused(_result: StreamPausedResult): Promise<void> {
    await this.finish('paused', _result.isTopicDone, _result.attemptId)
  }

  /**
   * Whether this terminal owes the channel a delivery. Attempt ids are process-global monotonic,
   * so a strictly newer one belongs to a successor execution (chain-hold carry-over, background
   * wake) owing its own delivery even though a prior execution's terminal already fired; a replay
   * of the settling execution's own id (payload-free held-topic close) stays deduplicated.
   */
  private owesDelivery(attemptId: number | undefined): boolean {
    if (!this.delivered) return true
    return attemptId !== undefined && (this.deliveredAttemptId === undefined || attemptId > this.deliveredAttemptId)
  }

  private async finish(status: 'success' | 'paused', isTopicDone?: boolean, attemptId?: number): Promise<void> {
    if (!this.owesDelivery(attemptId)) return
    const text = sanitizeChannelOutput(this.accumulatedText).text.trim()

    this.delivered = true
    if (attemptId !== undefined) this.deliveredAttemptId = attemptId
    if (!isTopicDone) {
      // Chain-hold gap: this turn is over but the topic lives on, so the next turn starts its own
      // message rather than re-posting this one alongside it.
      this.accumulatedText = ''
    }
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
    if (!this.owesDelivery(result.attemptId)) return
    this.delivered = true
    if (result.attemptId !== undefined) this.deliveredAttemptId = result.attemptId
    if (!result.isTopicDone) {
      // Same chain-hold gap as `finish`: a live sibling keeps the topic alive, so the successor turn
      // must not inherit this turn's un-delivered text.
      this.accumulatedText = ''
    }
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
