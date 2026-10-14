/** Finalizes a pending assistant placeholder without writing usage/cost. */

import { messageService } from '@main/data/services/MessageService'
import type { ContextSettingsOverride } from '@shared/data/types/contextSettings'
import type { AssistantTurnOptions, CherryUIMessage } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'
import { trimOversizedToolOutputs } from '../trimToolOutputs'

export interface MessageServiceBackendOptions {
  assistantMessageId: string
  /** Immutable request controls copied from the placeholder and retained across terminal writes. */
  turnOptions?: AssistantTurnOptions
  /** Assistant-layer context-settings override snapshot (taken at prepare time)
   *  — keeps the persist-time trim on the same effective settings as the turn. */
  contextSettingsOverride?: ContextSettingsOverride | null
  /** Post-success hook (topic auto-rename, usage reporting, …). */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class MessageServiceBackend implements PersistenceBackend {
  readonly kind = 'sqlite'
  readonly canPersistEmptyTerminal = true
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: MessageServiceBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status, runtimeStats } = input
    // Offload oversized tool outputs BEFORE the synchronous finalize tx (the
    // FileManager write is async); the tx then writes the envelope data and
    // its tool_output file refs together.
    const parts = await trimOversizedToolOutputs(finalMessage?.parts ?? [], this.opts.contextSettingsOverride)
    messageService.finalizeAssistantMessage(this.opts.assistantMessageId, {
      data: {
        parts,
        ...(this.opts.turnOptions ? { turnOptions: this.opts.turnOptions } : {})
      },
      status,
      runtimeStats
    })
  }

  /** Best-effort: flip the placeholder to `error` so a failed persist doesn't leave a frozen `pending` row. */
  markTerminalError(): void {
    messageService.update(this.opts.assistantMessageId, { status: 'error' })
  }
}
