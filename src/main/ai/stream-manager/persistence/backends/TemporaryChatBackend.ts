/**
 * In-memory temporary-chat backend — append-only writes to
 * `TemporaryChatService`. Temporary topics have no placeholder and no
 * tree; the listener simply appends the assistant result on terminal events.
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { CherryMessagePart, MessageStats, ModelSnapshot } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'

export interface TemporaryChatBackendOptions {
  topicId: string
  modelId?: string
  modelSnapshot?: ModelSnapshot
  /** Explicit stats override; wins over listener-composed `input.stats`. Usually undefined. */
  stats?: MessageStats
}

export class TemporaryChatBackend implements PersistenceBackend {
  readonly kind = 'temp'

  constructor(private readonly opts: TemporaryChatBackendOptions) {}

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status, stats } = input
    const parts = (finalMessage?.parts ?? []) as CherryMessagePart[]
    await temporaryChatService.appendMessage(this.opts.topicId, {
      role: 'assistant',
      data: { parts },
      status,
      modelId: this.opts.modelId,
      modelSnapshot: this.opts.modelSnapshot,
      stats: this.opts.stats ?? stats
    })
  }
}
