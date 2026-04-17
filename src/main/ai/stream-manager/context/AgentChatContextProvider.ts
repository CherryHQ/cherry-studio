/**
 * AgentChatContextProvider — owns `agent-session:{id}` topics.
 *
 * Unlike the persistent provider, agent sessions:
 *  - read their state from the agents DB (via agentService / sessionService)
 *  - persist messages through agentMessageRepository, not MessageService
 *  - resolve the model from the session record, not the assistant
 *  - submit via `manager.send` (agent steering semantics) instead of per-model
 *    `startExecution` fan-out
 */

import { loggerService } from '@logger'
import { agentService, sessionService } from '@main/services/agents'
import { agentMessageRepository } from '@main/services/agents/database/sessionMessageRepository'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import type { Message } from '@shared/data/types/message'
import { createUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { extractAgentSessionId, isAgentSessionTopic } from '../../provider/claudeCodeSettingsBuilder'
import type { AiStreamManager } from '../AiStreamManager'
import { AgentPersistenceListener } from '../listeners/AgentPersistenceListener'
import type { StreamListener } from '../types'
import type { ChatContextProvider } from './ChatContextProvider'

const logger = loggerService.withContext('AgentChatContextProvider')

export class AgentChatContextProvider implements ChatContextProvider {
  readonly name = 'agent-session'

  canHandle(topicId: string): boolean {
    return isAgentSessionTopic(topicId)
  }

  async handle(
    manager: AiStreamManager,
    subscriber: StreamListener,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    const sessionId = extractAgentSessionId(req.topicId)

    const { agents } = await agentService.listAgents()
    let session: Awaited<ReturnType<typeof sessionService.getSession>> = null
    for (const agent of agents) {
      session = await sessionService.getSession(agent.id, sessionId)
      if (session) break
    }
    if (!session) throw new Error(`Agent session not found: ${sessionId}`)

    // TODO： fix this after agent model refactor to v2
    const { providerId, modelId: rawModelId } = parseUniqueModelId(session.model as UniqueModelId)
    const uniqueModelId = createUniqueModelId(providerId, rawModelId)

    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    // Persist user message to agents DB
    const userMessageId = crypto.randomUUID()
    await agentMessageRepository.persistUserMessage({
      sessionId,
      agentSessionId: '',
      payload: {
        message: {
          id: userMessageId,
          role: 'user',
          assistantId: session.agent_id,
          topicId: req.topicId,
          createdAt: new Date().toISOString(),
          status: 'success',
          data: { parts: req.userMessageParts ?? [{ type: 'text', text: userText }] }
        },
        blocks: []
      }
    })

    const agentPersistenceListener = new AgentPersistenceListener({
      sessionId,
      agentId: session.agent_id
    })

    const result = manager.send({
      topicId: req.topicId,
      modelId: uniqueModelId,
      request: {
        chatId: req.topicId,
        trigger: 'submit-message',
        assistantId: session.agent_id,
        uniqueModelId,
        messages: [{ id: userMessageId, role: 'user', parts: [{ type: 'text', text: userText }] }]
      },
      userMessage: { id: userMessageId, topicId: req.topicId, role: 'user' } as Message,
      listeners: [subscriber, agentPersistenceListener]
    })

    logger.debug('Agent session stream dispatched', { sessionId, mode: result.mode })
    return { mode: result.mode }
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
