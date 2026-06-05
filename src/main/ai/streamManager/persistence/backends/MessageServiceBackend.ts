/** Finalizes a pending assistant placeholder via `messageService.update`. */

import { messageService } from '@main/data/services/MessageService'
import type { CherryMessagePart, CherryUIMessage, MessageStats, ModelSnapshot } from '@shared/data/types/message'

import { finalizeInterruptedParts, type PersistAssistantInput, type PersistenceBackend } from '../PersistenceBackend'

export interface MessageServiceBackendOptions {
  assistantMessageId: string
  /** Wins over `input.stats` — only set by callers replaying pre-computed stats. */
  stats?: MessageStats
  /** Parity with the listener signature; unused by the write. */
  modelSnapshot?: ModelSnapshot
  /** Post-success hook (topic auto-rename, usage reporting, …). */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class MessageServiceBackend implements PersistenceBackend {
  readonly kind = 'sqlite'
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: MessageServiceBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status, stats } = input
    const parts = finalizeInterruptedParts((finalMessage?.parts ?? []) as CherryMessagePart[], status)
    await messageService.update(this.opts.assistantMessageId, {
      data: { parts },
      status,
      stats: this.opts.stats ?? stats
    })
  }

  /** Best-effort: flip the placeholder to `error` so a failed persist doesn't leave a frozen `pending` row. */
  async markTerminalError(): Promise<void> {
    await messageService.update(this.opts.assistantMessageId, { status: 'error' })
  }
}
