/**
 * AgentChatContextProvider — owns `agent-session:{id}` topics.
 *
 * Unlike the persistent provider, agent sessions:
 *  - read their state from the agents DB (via agentService / sessionService)
 *  - persist messages through agentMessageRepository, not MessageService
 *  - resolve the model from the session record, not the assistant
 *  - always submit a single model (no `@mention` fan-out) and pass a
 *    `userMessage` so `manager.send` steers into any in-flight session.
 */

import { sessionService } from '@main/services/agents'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import type { Message } from '@shared/data/types/message'

import {
  extractAgentSessionId,
  isAgentSessionTopic,
  parseAgentSessionModel
} from '../../provider/claudeCodeSettingsBuilder'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { AgentMessageBackend } from '../persistence/backends/AgentMessageBackend'
import type { StreamListener } from '../types'
import type { ChatContextProvider, PreparedDispatch } from './ChatContextProvider'

export class AgentChatContextProvider implements ChatContextProvider {
  readonly name = 'agent-session'

  canHandle(topicId: string): boolean {
    return isAgentSessionTopic(topicId)
  }

  async prepareDispatch(subscriber: StreamListener, req: AiStreamOpenRequest): Promise<PreparedDispatch> {
    const sessionId = extractAgentSessionId(req.topicId)

    const session = await sessionService.getById(sessionId)
    if (!session) throw new Error(`Agent session not found: ${sessionId}`)

    const uniqueModelId = parseAgentSessionModel(session.model)

    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    const userMessageId = crypto.randomUUID()
    const userMessageParts = req.userMessageParts ?? [{ type: 'text', text: userText }]
    const createdAt = new Date().toISOString()

    // Persist user message to agents DB
    await agentMessageRepository.persistUserMessage({
      sessionId,
      agentSessionId: '',
      payload: {
        message: {
          id: userMessageId,
          role: 'user',
          assistantId: session.agent_id,
          topicId: req.topicId,
          createdAt,
          status: 'success',
          data: { parts: userMessageParts }
        },
        blocks: []
      }
    })

    const agentPersistenceListener = new PersistenceListener({
      topicId: req.topicId,
      modelId: uniqueModelId,
      backend: new AgentMessageBackend({ sessionId, agentId: session.agent_id })
    })

    return {
      topicId: req.topicId,
      models: [
        {
          modelId: uniqueModelId,
          request: {
            chatId: req.topicId,
            trigger: 'submit-message',
            assistantId: session.agent_id,
            uniqueModelId,
            messages: [{ id: userMessageId, role: 'user', parts: [{ type: 'text', text: userText }] }]
          }
        }
      ],
      // Passing userMessage means the dispatcher's `manager.send` can steer
      // the new prompt into any in-flight Claude Code session on this topic
      // via the pending queue. `data.parts` MUST be populated — downstream
      // consumers (Claude Code steeringSource, agentLoop pending drain) read
      // `msg.data?.parts`; a message without it is silently dropped.
      userMessage: {
        id: userMessageId,
        topicId: req.topicId,
        parentId: null,
        role: 'user',
        data: { parts: userMessageParts },
        status: 'success',
        siblingsGroupId: 0,
        createdAt,
        updatedAt: createdAt
      } satisfies Message,
      listeners: [subscriber, agentPersistenceListener],
      isMultiModel: false
    }
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
