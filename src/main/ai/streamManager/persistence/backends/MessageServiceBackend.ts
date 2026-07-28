/** Finalizes a pending assistant placeholder without writing usage/cost. */

import { messageService } from '@main/data/services/MessageService'
import type { CherryUIMessage, MessageStats } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'

export interface MessageServiceBackendOptions {
  assistantMessageId: string
  /** Wins over `input.stats` — only set by callers replaying pre-computed stats. */
  stats?: MessageStats
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
    const timingStats = this.opts.stats ?? stats
    messageService.finalizeAssistantMessage(this.opts.assistantMessageId, {
      data: { parts: finalMessage?.parts ?? [] },
      status,
      timingStats
    })
  }

  /** Best-effort: flip the placeholder to `error` so a failed persist doesn't leave a frozen `pending` row. */
  markTerminalError(): void {
    messageService.update(this.opts.assistantMessageId, { status: 'error' })
  }
}
