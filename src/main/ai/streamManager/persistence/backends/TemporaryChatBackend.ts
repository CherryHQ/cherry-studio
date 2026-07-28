/**
 * In-memory temporary-chat backend — append-only writes to
 * `TemporaryChatService`. Temporary topics have no placeholder and no
 * tree; the listener simply appends the assistant result on terminal events.
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { aiUsageRecordService } from '@main/data/services/aiUsageRecord'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { MessageSnapshot, MessageStats } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'

export interface TemporaryChatBackendOptions {
  topicId: string
  messageId: string
  modelId?: string
  messageSnapshot?: MessageSnapshot
  /** Explicit stats override; wins over listener-composed `input.stats`. Usually undefined. */
  stats?: MessageStats
}

export class TemporaryChatBackend implements PersistenceBackend {
  readonly kind = 'temp'

  constructor(private readonly opts: TemporaryChatBackendOptions) {}

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status, stats } = input
    const timingStats = this.opts.stats ?? stats
    const projection = aiUsageRecordService.getMessageUsageProjection({ kind: 'chat', id: this.opts.messageId })
    const combinedStats: MessageStats = {
      ...projection,
      ...(timingStats?.timeFirstTokenMs !== undefined ? { timeFirstTokenMs: timingStats.timeFirstTokenMs } : {}),
      ...(timingStats?.timeCompletionMs !== undefined ? { timeCompletionMs: timingStats.timeCompletionMs } : {}),
      ...(timingStats?.timeThinkingMs !== undefined ? { timeThinkingMs: timingStats.timeThinkingMs } : {})
    }
    temporaryChatService.appendMessage(
      this.opts.topicId,
      {
        role: 'assistant',
        data: { parts: finalMessage?.parts ?? [] },
        status,
        modelId: this.opts.modelId,
        messageSnapshot: this.opts.messageSnapshot,
        stats: Object.keys(combinedStats).length > 0 ? combinedStats : undefined
      },
      this.opts.messageId
    )
  }
}
