/**
 * Owns `agent-session:{id}` topics. Reads state from sessions /
 * agents, persists through `agentSessionMessageService`, single-model
 * only (no selector fan-out), passes `userMessage` for the inject path.
 */

import type { UIMessage } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { AgentSessionDeliveryRoutingError, agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { NotifyChannel } from '@main/ai/runtime/agentMcpServers'
import { topicNamingService } from '@main/services/TopicNamingService'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryMessagePart, CherryUIMessage, MessageSnapshot } from '@shared/data/types/message'
import { parseUniqueModelId, type ServiceTierSelection, type UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

import { extractAgentSessionId, isAgentSessionTopic } from '../../agentSession/topic'
import { applyTurnInputAttributes, startAiChildTurnSpan } from '../../observability'
import { runtimeDriverRegistry } from '../../runtime/registry'
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
      messageSnapshot: row.messageSnapshot ?? undefined,
      delivery: row.delivery ?? undefined,
      stats: row.stats ?? undefined,
      ...(row.stats?.totalTokens ? { totalTokens: row.stats.totalTokens } : {})
    }
  }
}

export type ValidatedAgentDispatch = {
  sessionId: string
  topicId: string
  agentId: string
  agentUpdatedAt: string
  agentType: string
  agentName: string
  uniqueModelId: UniqueModelId
  reasoningEffort: ReasoningEffortOption
  serviceTier: ServiceTierSelection
  fastMode?: boolean
  headless: boolean
  /** Undefined resolves the linked source channel; [] intentionally grants no notification recipients. */
  trustedNotifyChannels?: readonly NotifyChannel[]
  messageSnapshot: MessageSnapshot
  userMessageId: string
  userMessageParts: CherryMessagePart[]
  deliveryMessage?: AgentSessionMessageEntity
  shouldAutoNameInitialTurn: boolean
}

export type PersistedAgentDispatch = {
  validated: ValidatedAgentDispatch
  assistantMessageId: string
  traceId: string
  userMessage: AgentSessionMessageEntity
  savedMessages: AgentSessionMessageEntity[]
}

export interface AgentSessionTurnAuthority {
  /** Undefined resolves the linked source channel; [] intentionally grants no notification recipients. */
  trustedNotifyChannels?: readonly NotifyChannel[]
}

export class AgentChatContextProvider implements ChatContextProvider {
  readonly name = 'agent-session'
  readonly isPersistentConversation = true

  canHandle(topicId: string): boolean {
    return isAgentSessionTopic(topicId)
  }

  async validateDispatch(
    req: MainDispatchRequest,
    authority: AgentSessionTurnAuthority = {}
  ): Promise<ValidatedAgentDispatch> {
    if (req.trigger !== 'submit-message') {
      throw new Error(`Agent sessions only support 'submit-message' (got '${req.trigger}')`)
    }

    const sessionId = extractAgentSessionId(req.topicId)
    let session
    try {
      session = agentSessionService.getById(sessionId)
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        throw new AgentSessionDeliveryRoutingError('TARGET_UNAVAILABLE', `Target Session is unavailable: ${sessionId}`)
      }
      throw error
    }
    if (!session.agentId) {
      throw new AgentSessionDeliveryRoutingError(
        'TARGET_UNAVAILABLE',
        `Cannot dispatch on orphan session ${sessionId} — its agent was deleted`
      )
    }

    const agentId = session.agentId
    const agent = agentService.getAgent(agentId)
    if (!agent) {
      throw new AgentSessionDeliveryRoutingError('TARGET_UNAVAILABLE', `Agent not found for Session ${sessionId}`)
    }
    if (!agent.model) {
      throw new AgentSessionDeliveryRoutingError('TARGET_UNAVAILABLE', `Agent ${agent.id} has no model configured`)
    }

    const driver = runtimeDriverRegistry.getAgentSessionDriver(agent.type)
    if (!driver) {
      throw new AgentSessionDeliveryRoutingError('TARGET_UNAVAILABLE', `Unsupported agent runtime type: ${agent.type}`)
    }
    await driver.validateSession(session)

    const deliveryMessage = req.agentDeliveryMessage
    if (
      deliveryMessage &&
      (deliveryMessage.sessionId !== sessionId || deliveryMessage.role !== 'user' || !deliveryMessage.delivery)
    ) {
      throw new Error('Invalid durable agent delivery message')
    }

    const uniqueModelId = agent.model
    const { providerId, modelId: rawModelId } = parseUniqueModelId(uniqueModelId)
    const shouldAutoNameInitialTurn = deliveryMessage
      ? !agentSessionMessageService.hasSessionMessages(sessionId, deliveryMessage.id)
      : !agentSessionMessageService.hasSessionMessages(sessionId)
    return {
      sessionId,
      topicId: req.topicId,
      agentId,
      agentUpdatedAt: agent.updatedAt,
      agentType: agent.type,
      agentName: agent.name,
      uniqueModelId,
      reasoningEffort: req.reasoningEffort ?? agent.configuration?.reasoning_effort ?? 'default',
      serviceTier: req.serviceTier ?? agent.configuration?.service_tier ?? 'standard',
      fastMode: req.fastMode,
      headless: req.headless === true,
      ...(authority.trustedNotifyChannels !== undefined
        ? { trustedNotifyChannels: authority.trustedNotifyChannels }
        : {}),
      messageSnapshot: {
        id: agent.id,
        name: agent.name,
        // Normalized effective avatar (mirrors renderer `getAgentAvatar`).
        emoji: agent.configuration?.avatar?.trim() || '🤖',
        model: { id: rawModelId, name: agent.modelName ?? rawModelId, provider: providerId }
      },
      userMessageId: deliveryMessage?.id ?? uuidv7(),
      userMessageParts: deliveryMessage?.data.parts ?? req.userMessageParts ?? [],
      ...(deliveryMessage ? { deliveryMessage } : {}),
      shouldAutoNameInitialTurn
    }
  }

  persistDispatchTx(
    tx: DbOrTx,
    validated: ValidatedAgentDispatch,
    expectedAgent?: string | { id: string; updatedAt: string; model: string; type: string }
  ): PersistedAgentDispatch {
    const assistantMessageId = uuidv7()
    const savedMessages = agentSessionMessageService.saveMessagesTx(
      tx,
      {
        sessionId: validated.sessionId,
        messages: [
          {
            id: validated.userMessageId,
            role: 'user',
            status: 'success',
            data: { parts: validated.userMessageParts }
          },
          {
            id: assistantMessageId,
            role: 'assistant',
            status: 'pending',
            data: { parts: [] },
            modelId: validated.uniqueModelId,
            messageSnapshot: validated.messageSnapshot
          }
        ]
      },
      expectedAgent
    )
    return {
      validated,
      assistantMessageId,
      traceId: agentSessionService.ensureTraceIdTx(tx, validated.sessionId),
      userMessage: savedMessages[0],
      savedMessages
    }
  }

  activateDispatch(persisted: PersistedAgentDispatch, subscriber: StreamListener): PreparedDispatch {
    const { validated, assistantMessageId, traceId, userMessage, savedMessages } = persisted
    if (validated.shouldAutoNameInitialTurn) {
      topicNamingService.maybeRenameAgentSessionFromFirstUserMessage(validated.sessionId, userMessage.data)
    }

    const turnTrace = startAiChildTurnSpan(
      'ai.turn',
      {
        attributes: {
          'cs.topic_id': validated.topicId,
          'cs.trigger': 'submit-message',
          'cs.model_id': validated.uniqueModelId,
          'cs.role': 'assistant',
          'cs.agent_id': validated.agentId,
          'cs.session_id': validated.sessionId
        }
      },
      { topicId: validated.topicId, modelName: parseUniqueModelId(validated.uniqueModelId).modelId },
      traceId
    )

    applyTurnInputAttributes(turnTrace.rootSpan, {
      modelId: validated.uniqueModelId,
      topicId: validated.topicId,
      operation: 'invoke_agent',
      messages: [{ id: validated.userMessageId, role: 'user', parts: validated.userMessageParts }] as UIMessage[],
      agentName: validated.agentName
    })

    let runtime
    try {
      runtime = application.get('AgentSessionRuntimeService').beginTurn({
        sessionId: validated.sessionId,
        topicId: validated.topicId,
        agentId: validated.agentId,
        agentType: validated.agentType,
        modelId: validated.uniqueModelId,
        reasoningEffort: validated.reasoningEffort,
        serviceTier: validated.serviceTier,
        fastMode: validated.fastMode,
        assistantMessageId,
        userMessage,
        headless: validated.headless,
        trustedNotifyChannels: validated.trustedNotifyChannels,
        traceId,
        messageSnapshot: validated.messageSnapshot,
        shouldAutoName: validated.shouldAutoNameInitialTurn
      })
    } catch (error) {
      turnTrace.end('error', error instanceof Error ? error : new Error(String(error)))
      throw error
    }

    return {
      topicId: validated.topicId,
      models: [
        {
          modelId: validated.uniqueModelId,
          request: {
            chatId: validated.topicId,
            trigger: 'submit-message',
            assistantId: validated.agentId,
            uniqueModelId: validated.uniqueModelId,
            messages: [
              { id: validated.userMessageId, role: 'user', parts: validated.userMessageParts },
              { id: assistantMessageId, role: 'assistant', parts: [] }
            ],
            messageId: assistantMessageId,
            reasoningEffort: validated.reasoningEffort,
            serviceTier: validated.serviceTier,
            fastMode: validated.fastMode,
            runtime: { kind: 'agent-session', sessionId: validated.sessionId, turnId: runtime.turnId }
          },
          rootSpan: turnTrace.rootSpan,
          abortController: runtime.abortController
        }
      ],
      reservedMessages: savedMessages.map(toReservedAgentUIMessage),
      listeners: [subscriber, ...runtime.listeners]
    }
  }

  async prepareDispatch(
    subscriber: StreamListener,
    req: MainDispatchRequest,
    ctx?: DispatchContext
  ): Promise<PreparedDispatch> {
    return this.prepareAgentSessionDispatch(subscriber, req, {}, ctx)
  }

  async prepareAgentSessionDispatch(
    subscriber: StreamListener,
    req: MainDispatchRequest,
    authority: AgentSessionTurnAuthority,
    ctx?: DispatchContext
  ): Promise<PreparedDispatch> {
    const validated = await this.validateDispatch(req, authority)

    // Ordinary interactive follow-ups still use the runtime FIFO. Durable cross-Session deliveries
    // are gated by AgentSessionDeliveryService and never enter this branch.
    if (application.get('AgentSessionRuntimeService').isSessionBusy(validated.sessionId)) {
      if (ctx?.requireIdle) {
        throw DataApiErrorFactory.resourceLocked('Agent session', validated.sessionId, 'an active turn')
      }
      const savedUserMessage = agentSessionMessageService.saveMessage({
        sessionId: validated.sessionId,
        message: {
          id: validated.userMessageId,
          role: 'user',
          status: 'success',
          data: { parts: validated.userMessageParts }
        }
      })

      application.get('AgentSessionRuntimeService').enqueueUserMessage(validated.sessionId, savedUserMessage, {
        headless: validated.headless,
        trustedNotifyChannels: validated.trustedNotifyChannels,
        messageSnapshot: validated.messageSnapshot,
        reasoningEffort: validated.reasoningEffort,
        serviceTier: validated.serviceTier,
        fastMode: validated.fastMode
      })

      return {
        topicId: validated.topicId,
        models: [],
        reservedMessages: [toReservedAgentUIMessage(savedUserMessage)],
        listeners: [subscriber]
      }
    }

    const persisted = application
      .get('DbService')
      .withWriteTx((tx) => this.persistDispatchTx(tx, validated, ctx?.expectedAgentId))
    return this.activateDispatch(persisted, subscriber)
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
