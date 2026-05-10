/**
 * AgentChatContextProvider — owns `agent-session:{id}` topics.
 *
 * Unlike the persistent provider, agent sessions:
 *  - read their state from the agents DB (via sessionService + agentService)
 *  - persist messages through agentSessionMessageService, not MessageService
 *  - resolve the model from the parent agent (session is a pure instance)
 *  - always submit a single model (no `@mention` fan-out) and pass a
 *    `userMessage` so `manager.send` injects it into any in-flight
 *    session on this topic.
 */

import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { sessionService } from '@data/services/SessionService'
import { topicNamingService } from '@main/services/TopicNamingService'
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
import type { MainDispatchRequest } from './dispatch'

export class AgentChatContextProvider implements ChatContextProvider {
  readonly name = 'agent-session'

  canHandle(topicId: string): boolean {
    return isAgentSessionTopic(topicId)
  }

  async prepareDispatch(subscriber: StreamListener, req: MainDispatchRequest): Promise<PreparedDispatch> {
    if (req.trigger !== 'submit-message') {
      throw new Error(`Agent sessions only support 'submit-message' (got '${req.trigger}')`)
    }

    const sessionId = extractAgentSessionId(req.topicId)

    const session = await sessionService.getById(sessionId)
    if (!session.agentId) {
      throw new Error(`Cannot dispatch on orphan session ${sessionId} — its agent was deleted`)
    }
    const agentId = session.agentId
    const agent = await agentService.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found for session ${sessionId}: ${agentId}`)
    if (!agent.model) throw new Error(`Agent ${agent.id} has no model configured`)

    // The request below sends ONLY the latest user turn — no prior messages.
    // That works because Claude Code resumes context via its SDK session id
    // (see `lastAgentSessionId` plumbing in provider/config.ts). Any future
    // agent type that doesn't carry server-side conversation state would
    // see only the latest turn here. Reject early until that path supplies
    // a history loader.
    if (agent.type !== 'claude-code') {
      throw new Error(
        `AgentChatContextProvider only supports 'claude-code' agents (got '${agent.type}'); other types need a history loader before dispatch.`
      )
    }

    const uniqueModelId = parseAgentSessionModel(agent.model)

    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    const userMessageParts = req.userMessageParts ?? [{ type: 'text', text: userText }]
    const createdAt = new Date().toISOString()

    // Persist user message and reserve the pending assistant placeholder
    // atomically so the renderer's `useAgentSessionParts` refresh (triggered
    // by the upcoming `pending` broadcast) observes both rows together.
    await agentSessionMessageService.persistExchange({
      sessionId,
      agentSessionId: null,
      user: {
        payload: {
          message: {
            id: userMessageId,
            role: 'user',
            assistantId: agentId,
            topicId: req.topicId,
            createdAt,
            status: 'success',
            data: { parts: userMessageParts }
          },
          blocks: []
        }
      },
      assistant: {
        payload: {
          message: {
            id: assistantMessageId,
            role: 'assistant',
            assistantId: agentId,
            topicId: req.topicId,
            createdAt: new Date().toISOString(),
            status: 'pending',
            data: { parts: [] }
          },
          blocks: []
        }
      }
    })

    const agentPersistenceListener = new PersistenceListener({
      topicId: req.topicId,
      modelId: uniqueModelId,
      backend: new AgentMessageBackend({
        sessionId,
        agentId: agentId,
        afterPersist: async (finalMessage) => {
          await topicNamingService.maybeRenameAgentSession(agentId, sessionId, userText, finalMessage)
        }
      })
    })

    return {
      topicId: req.topicId,
      models: [
        {
          modelId: uniqueModelId,
          request: {
            chatId: req.topicId,
            trigger: 'submit-message',
            assistantId: agentId,
            uniqueModelId,
            messages: [{ id: userMessageId, role: 'user', parts: [{ type: 'text', text: userText }] }],
            messageId: assistantMessageId
          }
        }
      ],
      // Passing userMessage means the dispatcher's `manager.send` can
      // inject the new prompt into any in-flight Claude Code session
      // on this topic via the pending queue. `data.parts` MUST be
      // populated — downstream consumers (Claude Code injection source,
      // agentLoop pending-message drain) read `msg.data?.parts`; a
      // message without it is silently dropped.
      userMessage: {
        id: userMessageId,
        topicId: req.topicId,
        parentId: null,
        role: 'user',
        data: { parts: userMessageParts },
        searchableText: userText,
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
