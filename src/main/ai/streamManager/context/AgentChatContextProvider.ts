/**
 * Owns `agent-session:{id}` topics. Reads state from sessions /
 * agents, persists through `agentSessionMessageService`, single-model
 * only (no selector fan-out), passes `userMessage` for the inject path.
 */

import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { sessionService } from '@data/services/SessionService'
import { assertClaudeCodeWorkspaceDirectory } from '@main/ai/runtime/claudeCode/settingsBuilder'
import { application } from '@main/core/application'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/sessions'
import type { CherryUIMessage } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import { v7 as uuidv7 } from 'uuid'

import { extractAgentSessionId, isAgentSessionTopic } from '../../agentSession/topic'
import { startAiTurnTrace } from '../../observability'
import { runtimeDriverRegistry } from '../../runtime'
import type { StreamListener } from '../types'
import type { ChatContextProvider, DispatchContext, PreparedDispatch } from './ChatContextProvider'
import type { MainDispatchRequest } from './dispatch'

function toReservedAgentUIMessage(row: AgentSessionMessageEntity): CherryUIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: row.data.parts ?? [],
    metadata: {
      status: row.status,
      createdAt: row.createdAt,
      modelId: row.modelId ?? undefined,
      modelSnapshot: row.modelSnapshot ?? undefined,
      traceId: row.traceId ?? undefined,
      stats: row.stats ?? undefined,
      ...(row.stats?.totalTokens ? { totalTokens: row.stats.totalTokens } : {})
    }
  } as CherryUIMessage
}

export class AgentChatContextProvider implements ChatContextProvider {
  readonly name = 'agent-session'

  canHandle(topicId: string): boolean {
    return isAgentSessionTopic(topicId)
  }

  async prepareDispatch(
    subscriber: StreamListener,
    req: MainDispatchRequest,
    ctx: DispatchContext
  ): Promise<PreparedDispatch> {
    if (req.trigger !== 'submit-message') {
      throw new Error(`Agent sessions only support 'submit-message' (got '${req.trigger}')`)
    }

    const sessionId = extractAgentSessionId(req.topicId)

    const session = await sessionService.getById(sessionId)
    if (!session.agentId) {
      throw new Error(`Cannot dispatch on orphan session ${sessionId} — its agent was deleted`)
    }
    const workspacePath = session.workspace?.path
    if (!workspacePath) {
      throw new Error(`Agent session ${sessionId} has no workspace configured`)
    }
    await assertClaudeCodeWorkspaceDirectory(sessionId, workspacePath)

    const agentId = session.agentId
    const agent = await agentService.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found for session ${sessionId}: ${agentId}`)
    if (!agent.model) throw new Error(`Agent ${agent.id} has no model configured`)

    const driver = runtimeDriverRegistry.getAgentSessionDriver(agent.type)
    if (!driver) {
      throw new Error(`Unsupported agent runtime type: ${agent.type}`)
    }
    await driver.validateSession(session)

    const uniqueModelId = agent.model
    const { providerId, modelId: rawModelId } = parseUniqueModelId(uniqueModelId)
    const modelSnapshot = { id: rawModelId, name: agent.modelName ?? rawModelId, provider: providerId }

    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    const userMessageId = uuidv7()
    const userMessageParts = req.userMessageParts ?? [{ type: 'text', text: userText }]
    const createdAt = new Date().toISOString()

    const userMessage: AgentSessionMessageEntity = {
      id: userMessageId,
      sessionId,
      role: 'user',
      data: { parts: userMessageParts },
      status: 'success',
      searchableText: '',
      modelId: null,
      modelSnapshot: null,
      traceId: null,
      stats: null,
      runtimeResumeToken: null,
      createdAt,
      updatedAt: createdAt
    }

    if (ctx.hasLiveStream) {
      // Follow-up to a live turn: persist the user row, hand the message to the
      // runtime so it opens the next turn (interrupt → re-dispatch), and attach
      // the new subscriber. No new placeholder/model — that would orphan a row.
      const savedUserMessage = await agentSessionMessageService.saveMessage({
        sessionId,
        message: {
          id: userMessageId,
          role: 'user',
          status: 'success',
          data: { parts: userMessageParts }
        }
      })

      application.get('AgentSessionRuntimeService').enqueueUserMessage(sessionId, userMessage)

      return {
        topicId: req.topicId,
        models: [],
        userMessageId,
        reservedMessages: [toReservedAgentUIMessage(savedUserMessage)],
        listeners: [subscriber],
        isMultiModel: false
      }
    }

    const assistantMessageId = uuidv7()

    // Application root span. Claude Code child spans join this trace through TRACEPARENT.
    const turnTrace = startAiTurnTrace(
      'chat.turn',
      {
        attributes: {
          'cs.topic_id': req.topicId,
          'cs.trigger': req.trigger,
          'cs.model_id': uniqueModelId,
          'cs.role': 'assistant',
          'cs.agent_id': agentId,
          'cs.session_id': sessionId
        }
      },
      { topicId: req.topicId, modelName: parseUniqueModelId(uniqueModelId).modelId }
    )
    const traceId = turnTrace.traceId

    // Atomic user + pending-assistant write so `useAgentSessionParts` observes both at once.
    const savedMessages = await agentSessionMessageService.saveMessages({
      sessionId,
      messages: [
        {
          id: userMessageId,
          role: 'user',
          status: 'success',
          data: { parts: userMessageParts }
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId: uniqueModelId,
          modelSnapshot,
          traceId
        }
      ]
    })

    const runtime = application.get('AgentSessionRuntimeService').beginTurn({
      sessionId,
      topicId: req.topicId,
      agentId,
      agentType: agent.type,
      modelId: uniqueModelId,
      assistantMessageId,
      userMessage,
      traceId,
      rootSpanId: turnTrace.rootSpanId
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
            messages: [
              { id: userMessageId, role: 'user', parts: userMessageParts },
              { id: assistantMessageId, role: 'assistant', parts: [] }
            ],
            messageId: assistantMessageId,
            runtime: { kind: 'agent-session', sessionId, turnId: runtime.turnId }
          },
          rootSpan: turnTrace.rootSpan
        }
      ],
      userMessageId,
      reservedMessages: savedMessages.map(toReservedAgentUIMessage),
      listeners: [subscriber, ...runtime.listeners],
      isMultiModel: false
    }
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
