/**
 * In-memory temporary-chat backend — append-only writes to
 * `TemporaryChatService`. Temporary topics have no placeholder and no
 * tree; the listener simply appends the assistant result on terminal events.
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { MessageSnapshot, MessageStats } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'

export interface TemporaryChatBackendOptions {
  topicId: string
  modelId?: string
  messageSnapshot?: MessageSnapshot
  /** Explicit stats override; wins over listener-composed `input.stats`. Usually undefined. */
  stats?: MessageStats
}

export class TemporaryChatBackend implements PersistenceBackend {
  readonly kind = 'temp'

  constructor(private readonly opts: TemporaryChatBackendOptions) {}

  persistAssistant(input: PersistAssistantInput): void {
    const { finalMessage, status, stats } = input
    temporaryChatService.appendMessage(this.opts.topicId, {
      role: 'assistant',
      data: { parts: finalMessage?.parts ?? [] },
      status,
      modelId: this.opts.modelId,
      messageSnapshot: this.opts.messageSnapshot,
      stats: this.opts.stats ?? stats
    })
  }
}
