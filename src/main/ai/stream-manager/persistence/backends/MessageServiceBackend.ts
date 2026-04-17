/**
 * SQLite message-tree backend — finalizes a pre-created "pending" placeholder
 * assistant message via `messageService.update`.
 *
 * Created by the Persistent chat context provider, one per execution (so
 * multi-model turns produce N placeholders, N backends, N update calls).
 */

import { messageService } from '@main/data/services/MessageService'
import type { CherryMessagePart, CherryUIMessage, MessageStats, ModelSnapshot } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend, PersistErrorInput } from '../PersistenceBackend'

export interface MessageServiceBackendOptions {
  /** Placeholder assistant message id created before the stream started. */
  assistantMessageId: string
  /** Explicit stats override. If omitted, derived from `finalMessage.metadata.totalTokens`. */
  stats?: MessageStats
  /** Kept for parity with the listener signature; unused by the storage write. */
  modelSnapshot?: ModelSnapshot
  /** Post-success hook — typically topic auto-rename / usage reporting. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class MessageServiceBackend implements PersistenceBackend {
  readonly kind = 'sqlite'
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: MessageServiceBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status } = input
    await messageService.update(this.opts.assistantMessageId, {
      data: { parts: finalMessage.parts as CherryMessagePart[] },
      status,
      stats: this.opts.stats ?? statsFromMetadata(finalMessage)
    })
  }

  async persistError(input: PersistErrorInput): Promise<void> {
    const partialParts = (input.partialMessage?.parts ?? []) as CherryMessagePart[]
    const errorPart = { type: 'data-error' as const, data: { ...input.error } }
    await messageService.update(this.opts.assistantMessageId, {
      data: { parts: [...partialParts, errorPart] },
      status: 'error',
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
