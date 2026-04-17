/**
 * Agents DB backend — writes assistant turns to the `session_messages`
 * table via `agentMessageRepository`. The user message is persisted by
 * AgentChatContextProvider before streaming starts (not here).
 */

import { buildAgentSessionTopicId } from '@main/ai/provider/claudeCodeSettingsBuilder'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UIMessage } from 'ai'

import type { PersistAssistantInput, PersistenceBackend, PersistErrorInput } from '../PersistenceBackend'

export interface AgentMessageBackendOptions {
  /** Cherry Studio session id (not the SDK session id). */
  sessionId: string
  /** Agent id that owns the session. */
  agentId: string
  /** Claude Code / SDK session token for resume; empty string when unknown. */
  agentSessionId?: string
}

export class AgentMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'

  constructor(private readonly opts: AgentMessageBackendOptions) {}

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    await this.write(input.finalMessage, input.status)
  }

  async persistError(input: PersistErrorInput): Promise<void> {
    const partialParts = (input.partialMessage?.parts ?? []) as CherryMessagePart[]
    const errorPart = { type: 'data-error' as const, data: { ...input.error } }
    const synthetic: UIMessage = {
      id: input.partialMessage?.id ?? crypto.randomUUID(),
      role: 'assistant',
      parts: [...partialParts, errorPart] as UIMessage['parts']
    } as UIMessage
    await this.write(synthetic as CherryUIMessage, 'error')
  }

  private async write(finalMessage: CherryUIMessage, status: 'success' | 'paused' | 'error'): Promise<void> {
    await agentMessageRepository.persistAssistantMessage({
      sessionId: this.opts.sessionId,
      agentSessionId: this.opts.agentSessionId ?? '',
      payload: {
        message: {
          id: finalMessage.id,
          role: 'assistant',
          assistantId: this.opts.agentId,
          topicId: buildAgentSessionTopicId(this.opts.sessionId),
          createdAt: new Date().toISOString(),
          status,
          data: { parts: finalMessage.parts as CherryMessagePart[] }
        },
        blocks: []
      }
    })
  }
}
