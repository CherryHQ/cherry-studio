/**
 * In-memory temporary-chat backend — append-only writes to
 * `TemporaryChatService`. Temporary topics have no placeholder and no
 * tree; the listener simply appends the assistant result on terminal events.
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { MessageSnapshot } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'

export interface TemporaryChatBackendOptions {
  topicId: string
  messageId: string
  modelId?: string
  messageSnapshot?: MessageSnapshot
}

export class TemporaryChatBackend implements PersistenceBackend {
  readonly kind = 'temp'

  constructor(private readonly opts: TemporaryChatBackendOptions) {}

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status, runtimeStats } = input
    temporaryChatService.appendAssistantMessage(
      this.opts.topicId,
      {
        role: 'assistant',
        data: { parts: finalMessage?.parts ?? [] },
        status,
        modelId: this.opts.modelId,
        messageSnapshot: this.opts.messageSnapshot
      },
      runtimeStats,
      this.opts.messageId
    )
  }
}
