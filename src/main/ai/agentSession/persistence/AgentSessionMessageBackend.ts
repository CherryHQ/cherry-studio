/**
 * Agent-session DB backend — settles the pre-reserved assistant placeholder in
 * the `agent_session_message` table via `agentSessionMessageService`. The user
 * message is persisted by AgentChatContextProvider before streaming starts.
 *
 * All writes here are stream-owned terminal settlements: they are UPDATE-only
 * and pending-only, so a placeholder deleted mid-stream is never recreated and
 * a row already settled by another owner is never overwritten.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { PersistAssistantInput, PersistenceBackend } from '../../streamManager'

export interface AgentSessionMessageBackendOptions {
  /** Cherry Studio agent-session id. */
  sessionId: string
  /** Existing assistant placeholder id to finalize. */
  assistantMessageId: string
  /** Model id used for this assistant message. */
  modelId?: UniqueModelId
  /** Opaque runtime resume token persisted for future recovery; `undefined` when unknown. */
  runtimeResumeToken?: string | (() => string | undefined)
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentSessionMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly canPersistEmptyTerminal = true
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentSessionMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  persistAssistant(input: PersistAssistantInput): void {
    const { finalMessage, status, runtimeStats } = input
    const runtimeResumeToken = this.getRuntimeResumeToken()
    agentSessionMessageService.settlePendingAssistantMessage({
      sessionId: this.opts.sessionId,
      messageId: finalMessage?.id ?? this.opts.assistantMessageId,
      ...(runtimeResumeToken ? { runtimeResumeToken } : {}),
      ...(runtimeStats ? { runtimeStats } : {}),
      ...(this.opts.modelId !== undefined ? { modelId: this.opts.modelId } : {}),
      status,
      data: { parts: finalMessage?.parts ?? [] }
    })
  }

  markTerminalError(): void {
    agentSessionMessageService.settlePendingAssistantMessage({
      sessionId: this.opts.sessionId,
      messageId: this.opts.assistantMessageId,
      status: 'error',
      data: { parts: [] }
    })
  }

  private getRuntimeResumeToken(): string | undefined {
    return typeof this.opts.runtimeResumeToken === 'function'
      ? this.opts.runtimeResumeToken()
      : this.opts.runtimeResumeToken
  }
}
