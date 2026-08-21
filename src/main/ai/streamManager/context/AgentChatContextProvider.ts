/**
 * Agent HistoryPort adapter. Reads state from sessions /
 * agents, persists through `agentSessionMessageService`, single-model
 * only (no selector fan-out), passes `userMessage` for the inject path.
 */

import { application } from '@application'
import type { DbTxWithEffects } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { AgentSessionDeliveryRoutingError, agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicNamingService } from '@main/services/TopicNamingService'
import { ConversationKind, ConversationOpenTrigger, type ConversationRef } from '@shared/ai/conversation'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryUIMessage } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { UIMessage } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { type AgentConversationRuntimeTurnIntent } from '../../agentSession/AgentConnectionManager'
import { AgentDriverOutcomeKind } from '../../agentSession/agentConnectionResourceState'
import { AgentSessionMessageBackend } from '../../agentSession/persistence/AgentSessionMessageBackend'
import { applyTurnInputAttributes, startAiChildTurnSpan } from '../../observability'
import { runtimeDriverRegistry } from '../../runtime/registry'
import { AiRuntimeKind } from '../../types'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TraceFlushListener } from '../listeners/TraceFlushListener'
import type { StreamListener } from '../types'
import {
  type CommittedDispatch,
  type ConversationExecutionContext,
  ConversationHistoryAdapterKind,
  type ConversationHistoryPort,
  type DispatchContext,
  type ValidatedAgentDispatch,
  type ValidatedDispatch
} from './ConversationHistoryPort'
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
  } as CherryUIMessage
}

function extractUserText(message: AgentSessionMessageEntity): string {
  return (
    message.data.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

export type PersistedAgentDispatch = {
  validated: ValidatedAgentDispatch
  assistantMessageId: string
  traceId: string
  userMessage: AgentSessionMessageEntity
  savedMessages: AgentSessionMessageEntity[]
}

export class AgentChatContextProvider implements ConversationHistoryPort {
  readonly name = 'agent-session'
  readonly isPersistentConversation = true

  canHandle(conversation: ConversationRef): boolean {
    return conversation.kind === ConversationKind.Agent
  }

  private async validateAgentDispatch(req: MainDispatchRequest, signal: AbortSignal): Promise<ValidatedAgentDispatch> {
    if (req.trigger !== ConversationOpenTrigger.SubmitMessage) {
      throw new Error(`Agent sessions only support 'submit-message' (got '${req.trigger}')`)
    }

    const sessionId = req.conversation.id
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
    signal.throwIfAborted()

    const deliveryMessage = req.agentDeliveryMessage
    if (deliveryMessage && (deliveryMessage.sessionId !== sessionId || deliveryMessage.role !== 'user')) {
      throw new Error('Invalid durable agent delivery message')
    }

    const uniqueModelId = agent.model
    const { providerId, modelId: rawModelId } = parseUniqueModelId(uniqueModelId)
    const shouldAutoNameInitialTurn = deliveryMessage
      ? !agentSessionMessageService.hasSessionMessages(sessionId, deliveryMessage.id)
      : !agentSessionMessageService.hasSessionMessages(sessionId)
    return {
      sessionId,
      agentId,
      agentUpdatedAt: agent.updatedAt,
      agentType: agent.type,
      agentName: agent.name,
      uniqueModelId,
      reasoningEffort: req.reasoningEffort ?? agent.configuration?.reasoning_effort ?? 'default',
      fastMode: req.fastMode,
      headless: req.headless === true,
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
    tx: DbTxWithEffects,
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
    if (validated.deliveryMessage?.delivery?.status === 'accepted') {
      const claimed = agentSessionMessageService.claimSessionDeliveryTx(
        tx,
        validated.sessionId,
        validated.deliveryMessage.id,
        assistantMessageId
      )
      if (!claimed) throw new Error(`Agent Session delivery ${validated.deliveryMessage.id} lost its accepted claim`)
    }
    return {
      validated,
      assistantMessageId,
      traceId: agentSessionService.ensureTraceIdTx(tx, validated.sessionId),
      userMessage: savedMessages[0],
      savedMessages
    }
  }

  commitPersistedDispatch(persisted: PersistedAgentDispatch, subscriber: StreamListener): CommittedDispatch {
    const { validated, assistantMessageId, traceId, userMessage, savedMessages } = persisted
    if (validated.shouldAutoNameInitialTurn) {
      topicNamingService.maybeRenameAgentSessionFromFirstUserMessage(validated.sessionId, userMessage.data)
    }

    const turnTrace = startAiChildTurnSpan(
      'ai.turn',
      {
        attributes: {
          'cs.topic_id': validated.sessionId,
          'cs.trigger': 'submit-message',
          'cs.model_id': validated.uniqueModelId,
          'cs.role': 'assistant',
          'cs.agent_id': validated.agentId,
          'cs.session_id': validated.sessionId
        }
      },
      { topicId: validated.sessionId, modelName: parseUniqueModelId(validated.uniqueModelId).modelId },
      traceId
    )

    applyTurnInputAttributes(turnTrace.rootSpan, {
      modelId: validated.uniqueModelId,
      topicId: validated.sessionId,
      operation: 'invoke_agent',
      messages: [{ id: validated.userMessageId, role: 'user', parts: validated.userMessageParts }] as UIMessage[],
      agentName: validated.agentName
    })

    const conversation = { kind: ConversationKind.Agent, id: validated.sessionId } as const
    const runtimeTurnId = crypto.randomUUID()
    const abortController = new AbortController()
    const manager = application.get('AgentConnectionManager')
    const releaseListener = manager.createExecutionReleaseListener(conversation, runtimeTurnId)
    const persistencePorts = [
      new PersistenceListener({
        topicId: validated.sessionId,
        modelId: validated.uniqueModelId,
        backend: new AgentSessionMessageBackend({
          sessionId: validated.sessionId,
          assistantMessageId,
          modelId: validated.uniqueModelId,
          runtimeResumeToken: () => manager.runtimeResumeToken(validated.sessionId),
          ...(validated.shouldAutoNameInitialTurn
            ? {
                afterPersist: (finalMessage: CherryUIMessage) =>
                  topicNamingService.maybeRenameAgentSession(
                    validated.agentId,
                    validated.sessionId,
                    extractUserText(userMessage),
                    finalMessage
                  )
              }
            : {})
        })
      })
    ]
    const cleanupPorts = [new TraceFlushListener(validated.sessionId)]
    const listeners = [subscriber, releaseListener]
    const reservedMessages = savedMessages.map(toReservedAgentUIMessage)
    return {
      reservation: {
        conversation,
        models: [
          {
            modelId: validated.uniqueModelId,
            outputNodeId: assistantMessageId,
            rootSpan: turnTrace.rootSpan,
            abortController
          }
        ],
        listeners,
        persistencePorts,
        cleanupPorts,
        reservedMessages
      },
      prepareExecutionContext: async (signal) => {
        signal.throwIfAborted()
        manager.prepareTurnResources({
          conversation,
          agentId: validated.agentId,
          agentType: validated.agentType,
          modelId: validated.uniqueModelId,
          reasoningEffort: validated.reasoningEffort,
          fastMode: validated.fastMode,
          assistantMessageId,
          userMessage,
          headless: validated.headless,
          traceId,
          messageSnapshot: validated.messageSnapshot,
          shouldAutoName: validated.shouldAutoNameInitialTurn,
          turnId: runtimeTurnId,
          abortController
        })
        signal.throwIfAborted()
        return {
          conversation,
          models: [
            {
              modelId: validated.uniqueModelId,
              request: {
                chatId: validated.sessionId,
                trigger: ConversationOpenTrigger.SubmitMessage,
                assistantId: validated.agentId,
                uniqueModelId: validated.uniqueModelId,
                messages: [
                  { id: validated.userMessageId, role: 'user', parts: validated.userMessageParts },
                  { id: assistantMessageId, role: 'assistant', parts: [] }
                ],
                messageId: assistantMessageId,
                reasoningEffort: validated.reasoningEffort,
                fastMode: validated.fastMode,
                runtime: { kind: AiRuntimeKind.AgentSession, sessionId: validated.sessionId, turnId: runtimeTurnId }
              },
              rootSpan: turnTrace.rootSpan,
              abortController
            }
          ]
        } satisfies ConversationExecutionContext
      }
    }
  }

  commitRuntimeTurn(intent: AgentConversationRuntimeTurnIntent, subscriber: StreamListener): CommittedDispatch {
    const manager = application.get('AgentConnectionManager')
    let assistantMessage: AgentSessionMessageEntity
    try {
      assistantMessage = agentSessionMessageService.saveMessage({
        sessionId: intent.conversation.id,
        message: {
          id: intent.assistantMessageId,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId: intent.modelId,
          messageSnapshot: intent.messageSnapshot
        }
      })
    } catch (error) {
      manager.rejectConversationRuntimeTurn(intent)
      throw error
    }

    const messages = [
      { id: intent.userMessage.id, role: 'user' as const, parts: intent.userMessage.data.parts ?? [] },
      { id: assistantMessage.id, role: 'assistant' as const, parts: [] }
    ]
    if (intent.rootSpan) {
      applyTurnInputAttributes(intent.rootSpan, {
        modelId: intent.modelId,
        topicId: intent.conversation.id,
        operation: 'invoke_agent',
        messages
      })
    }
    const persistencePorts = [
      new PersistenceListener({
        topicId: intent.conversation.id,
        modelId: intent.modelId,
        backend: new AgentSessionMessageBackend({
          sessionId: intent.conversation.id,
          assistantMessageId: assistantMessage.id,
          modelId: intent.modelId,
          runtimeResumeToken: () => manager.runtimeResumeToken(intent.conversation.id)
        })
      })
    ]
    const release = (outcome: AgentDriverOutcomeKind) => {
      manager.releaseExecutionResource({
        conversation: intent.conversation,
        turnId: intent.runtimeTurnId,
        outcome
      })
      manager.rejectConversationRuntimeTurn(intent, false)
    }
    const releaseListener: StreamListener = {
      id: `agent-runtime:${intent.conversation.id}`,
      onChunk: () => {},
      onDone: () => release(AgentDriverOutcomeKind.Success),
      onPaused: (result) => {
        if (result.turnTerminal !== false) release(AgentDriverOutcomeKind.Paused)
      },
      onError: () => release(AgentDriverOutcomeKind.Error),
      isAlive: () => true
    }
    const listeners = [subscriber, releaseListener]
    const cleanupPorts = [new TraceFlushListener(intent.conversation.id)]
    const reservedMessages = [toReservedAgentUIMessage(assistantMessage)]
    return {
      reservation: {
        conversation: intent.conversation,
        models: [
          {
            modelId: intent.modelId,
            outputNodeId: assistantMessage.id,
            rootSpan: intent.rootSpan,
            abortController: intent.abortController
          }
        ],
        listeners,
        persistencePorts,
        cleanupPorts,
        reservedMessages
      },
      prepareExecutionContext: async (signal) => {
        await manager.activateConversationRuntimeTurn(intent, signal)
        signal.throwIfAborted()
        return {
          conversation: intent.conversation,
          models: [
            {
              modelId: intent.modelId,
              request: {
                chatId: intent.conversation.id,
                trigger: ConversationOpenTrigger.SubmitMessage,
                assistantId: intent.agentId,
                uniqueModelId: intent.modelId,
                messageId: assistantMessage.id,
                messages,
                reasoningEffort: intent.reasoningEffort,
                ...(intent.fastMode ? { fastMode: true } : {}),
                runtime: {
                  kind: AiRuntimeKind.AgentSession,
                  sessionId: intent.conversation.id,
                  turnId: intent.runtimeTurnId
                }
              },
              rootSpan: intent.rootSpan,
              abortController: intent.abortController
            }
          ]
        } satisfies ConversationExecutionContext
      }
    }
  }

  async validateDispatch(
    req: MainDispatchRequest,
    ctx: DispatchContext,
    signal: AbortSignal
  ): Promise<ValidatedDispatch> {
    const agent = await this.validateAgentDispatch(req, signal)
    return {
      kind: ConversationHistoryAdapterKind.Agent,
      request: req,
      context: ctx,
      executionCount: ctx.hasLiveStream ? 0 : 1,
      agent
    }
  }

  commitDispatch(
    subscriber: StreamListener,
    validation: ValidatedDispatch,
    context: DispatchContext
  ): CommittedDispatch {
    if (validation.kind !== ConversationHistoryAdapterKind.Agent) {
      throw new Error(`Agent HistoryPort received ${validation.kind} validation`)
    }
    const validated = validation.agent
    const ctx = context

    // The Conversation owner has already classified this as an active-turn input. Persist the user
    // row here; it decides redirect versus next-turn admission after this effect returns.
    if (ctx?.hasLiveStream) {
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

      const executionContext: ConversationExecutionContext = {
        conversation: { kind: ConversationKind.Agent, id: validated.sessionId },
        models: []
      }
      return {
        reservation: {
          conversation: executionContext.conversation,
          models: [],
          listeners: [subscriber],
          persistencePorts: [],
          cleanupPorts: [],
          reservedMessages: [toReservedAgentUIMessage(savedUserMessage)]
        },
        prepareExecutionContext: async (signal) => {
          signal.throwIfAborted()
          return executionContext
        }
      }
    }

    const persisted = application
      .get('DbService')
      .withWriteTx((tx) => this.persistDispatchTx(tx, validated, ctx?.expectedAgentId))
    return this.commitPersistedDispatch(persisted, subscriber)
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
