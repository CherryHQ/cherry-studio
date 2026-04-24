/**
 * Agents DB backend — writes assistant turns to the `session_messages`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { buildAgentSessionTopicId } from '@main/ai/provider/claudeCodeSettingsBuilder'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import type { PersistAssistantInput, PersistenceBackend } from '../PersistenceBackend'

export interface AgentMessageBackendOptions {
  /** Cherry Studio session id (not the SDK session id). */
  sessionId: string
  /** Agent id that owns the session. */
  agentId: string
  /** Claude Code / SDK session token for resume; empty string when unknown. */
  agentSessionId?: string
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status } = input
    const parts = (finalMessage?.parts ?? []) as CherryMessagePart[]
    await agentSessionMessageService.persistAssistantMessage({
      sessionId: this.opts.sessionId,
      agentSessionId: this.opts.agentSessionId ?? '',
      payload: {
        message: {
          id: finalMessage?.id ?? crypto.randomUUID(),
          role: 'assistant',
          assistantId: this.opts.agentId,
          topicId: buildAgentSessionTopicId(this.opts.sessionId),
          createdAt: new Date().toISOString(),
          status,
          data: { parts }
        },
        blocks: []
      }
    })
  }
}
