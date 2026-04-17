/**
 * In-memory temporary-chat backend — append-only writes to
 * `TemporaryChatService`. Temporary topics have no placeholder and no
 * tree; the listener simply appends the assistant result on terminal events.
 */

import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import type { CherryMessagePart, CherryUIMessage, MessageStats, ModelSnapshot } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend, PersistErrorInput } from '../PersistenceBackend'

export interface TemporaryChatBackendOptions {
  topicId: string
  modelId?: string
  modelSnapshot?: ModelSnapshot
  stats?: MessageStats
}

export class TemporaryChatBackend implements PersistenceBackend {
  readonly kind = 'temp'

  constructor(private readonly opts: TemporaryChatBackendOptions) {}

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    await temporaryChatService.appendMessage(this.opts.topicId, {
      role: 'assistant',
      data: { parts: input.finalMessage.parts as CherryMessagePart[] },
      status: input.status,
      modelId: this.opts.modelId,
      modelSnapshot: this.opts.modelSnapshot,
      stats: this.opts.stats ?? statsFromMetadata(input.finalMessage)
    })
  }

  async persistError(input: PersistErrorInput): Promise<void> {
    const partialParts = (input.partialMessage?.parts ?? []) as CherryMessagePart[]
    const errorPart = { type: 'data-error' as const, data: { ...input.error } }
    await temporaryChatService.appendMessage(this.opts.topicId, {
      role: 'assistant',
      data: { parts: [...partialParts, errorPart] },
      status: 'error',
      modelId: this.opts.modelId,
      modelSnapshot: this.opts.modelSnapshot,
      stats: this.opts.stats
    })
  }
}

function statsFromMetadata(finalMessage: CherryUIMessage): MessageStats | undefined {
  const meta = finalMessage.metadata
  if (meta && typeof meta === 'object' && 'totalTokens' in meta) {
    return { totalTokens: (meta as { totalTokens: number }).totalTokens }
  }
  return undefined
}
