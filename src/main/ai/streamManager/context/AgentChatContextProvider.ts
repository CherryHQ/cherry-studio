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
import {
  ConversationActiveNodeMove,
  ConversationKind,
  ConversationOpenTrigger,
  ConversationOutcomeKind,
  type ConversationRef
} from '@shared/ai/conversation'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryUIMessage } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import { v7 as uuidv7 } from 'uuid'

import {
  type AgentConversationRuntimeTurnIntent,
  AgentConversationRuntimeTurnKind
} from '../../agentSession/AgentConnectionManager'
import { AgentSessionMessageBackend } from '../../agentSession/persistence/AgentSessionMessageBackend'
import { runtimeDriverRegistry } from '../../runtime/registry'
import { AiRuntimeKind } from '../../types'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { finalizeInterruptedParts } from '../persistence/PersistenceBackend'
import {
  type CommittedConversationIntent,
  ConversationAfterPersistTaskKind,
  ConversationAgentRuntimeTurnKind,
  type ConversationCrashRecoveryResult,
  type ConversationExecutionContext,
  ConversationExecutionDriverBindingKind,
  type ConversationExecutionPreparationDescriptor,
  ConversationExecutionPreparationKind,
  ConversationHistoryAdapterKind,
  type ConversationHistoryPort,
  type ConversationIntentValidationContext,
  ConversationPostCommitTaskKind,
  ConversationTelemetryKind,
  type ConversationTerminalPersistenceDescriptor,
  ConversationTerminalPersistenceKind,
  type ConversationTerminalWrite,
  type ValidatedAgentIntent,
  type ValidatedConversationInputFailure,
  type ValidatedConversationIntent
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
  validated: ValidatedAgentIntent
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

  recoverCrashOrphans(): ConversationCrashRecoveryResult {
    const stale = agentSessionMessageService.findCrashOrphanedAssistantMessages()
    if (stale.length === 0) return { repairedOutputs: [] }
    const sessionIds = [...new Set(stale.map(({ sessionId }) => sessionId))]
    agentSessionMessageService.resolveCrashOrphanedMessages(
      stale.map(({ id, data }) => ({
        id,
        data: { ...data, parts: finalizeInterruptedParts(data.parts ?? [], ConversationOutcomeKind.Error) }
      })),
      sessionIds
    )
    return { repairedOutputs: stale.map(({ id }) => ({ outputNodeId: id, status: 'error' })) }
  }

  private async validateAgentDispatch(req: MainDispatchRequest, signal: AbortSignal): Promise<ValidatedAgentIntent> {
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
      serviceTier: req.serviceTier ?? agent.configuration?.service_tier ?? 'standard',
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
    validated: ValidatedAgentIntent,
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

  commitPersistedIntent(persisted: PersistedAgentDispatch): CommittedConversationIntent {
    const { validated, assistantMessageId, traceId, userMessage, savedMessages } = persisted

    const conversation = { kind: ConversationKind.Agent, id: validated.sessionId } as const
    const runtimeTurnId = crypto.randomUUID()
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.AgentFresh,
      conversation,
      agentId: validated.agentId,
      agentType: validated.agentType,
      modelId: validated.uniqueModelId,
      reasoningEffort: validated.reasoningEffort,
      serviceTier: validated.serviceTier,
      fastMode: validated.fastMode === true,
      outputNodeId: assistantMessageId,
      userMessage,
      headless: validated.headless,
      traceId,
      messageSnapshot: validated.messageSnapshot,
      shouldAutoName: validated.shouldAutoNameInitialTurn,
      runtimeTurnId
    }
    return {
      conversation,
      input: { historyNodeId: userMessage.id },
      executions: [
        {
          modelId: validated.uniqueModelId,
          outputNodeId: assistantMessageId,
          preparation,
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.Agent,
            sessionId: validated.sessionId,
            assistantMessageId,
            modelId: validated.uniqueModelId
          },
          ...(validated.shouldAutoNameInitialTurn
            ? {
                afterPersist: {
                  kind: ConversationAfterPersistTaskKind.RenameAgentFromSummary,
                  agentId: validated.agentId,
                  sessionId: validated.sessionId,
                  userText: extractUserText(userMessage)
                }
              }
            : {}),
          telemetry: {
            kind: ConversationTelemetryKind.Agent,
            sessionId: validated.sessionId,
            trigger: ConversationOpenTrigger.SubmitMessage,
            traceId,
            modelId: validated.uniqueModelId,
            modelName: parseUniqueModelId(validated.uniqueModelId).modelId,
            agentId: validated.agentId,
            agentName: validated.agentName
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Agent, runtimeTurnId }
        }
      ],
      reservedMessages: savedMessages.map(toReservedAgentUIMessage),
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: [
        ...(validated.shouldAutoNameInitialTurn
          ? [
              {
                kind: ConversationPostCommitTaskKind.RenameAgentFromFirstUser as const,
                sessionId: validated.sessionId,
                userMessageData: userMessage.data
              }
            ]
          : []),
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: validated.sessionId }
      ]
    }
  }

  commitRuntimeIntent(intent: AgentConversationRuntimeTurnIntent): CommittedConversationIntent {
    const assistantMessage = agentSessionMessageService.saveMessage({
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

    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.AgentRuntime,
      runtimeKind:
        intent.kind === AgentConversationRuntimeTurnKind.Autonomous
          ? ConversationAgentRuntimeTurnKind.Autonomous
          : ConversationAgentRuntimeTurnKind.NativeContinuation,
      conversation: intent.conversation,
      agentId: intent.agentId,
      modelId: intent.modelId,
      reasoningEffort: intent.reasoningEffort,
      serviceTier: intent.serviceTier,
      fastMode: intent.fastMode,
      knowledgeBaseIds: intent.knowledgeBaseIds,
      headless: intent.headless,
      userMessage: intent.userMessage,
      outputNodeId: assistantMessage.id,
      runtimeTurnId: intent.runtimeTurnId,
      segmentId: intent.segmentId,
      sourceTurnId: intent.sourceTurnId,
      messageSnapshot: intent.messageSnapshot,
      traceId: intent.traceId
    }
    return {
      conversation: intent.conversation,
      input: { historyNodeId: intent.userMessage.id },
      executions: [
        {
          modelId: intent.modelId,
          outputNodeId: assistantMessage.id,
          preparation,
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.Agent,
            sessionId: intent.conversation.id,
            assistantMessageId: assistantMessage.id,
            modelId: intent.modelId
          },
          ...(intent.traceId
            ? {
                telemetry: {
                  kind: ConversationTelemetryKind.Agent,
                  sessionId: intent.conversation.id,
                  trigger: ConversationOpenTrigger.SubmitMessage,
                  traceId: intent.traceId,
                  modelId: intent.modelId,
                  modelName: parseUniqueModelId(intent.modelId).modelId,
                  agentId: intent.agentId
                }
              }
            : {}),
          driver: { kind: ConversationExecutionDriverBindingKind.Agent, runtimeTurnId: intent.runtimeTurnId }
        }
      ],
      reservedMessages: [toReservedAgentUIMessage(assistantMessage)],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: [
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: intent.conversation.id }
      ]
    }
  }

  async validateIntent(
    req: MainDispatchRequest,
    ctx: ConversationIntentValidationContext,
    signal: AbortSignal
  ): Promise<ValidatedConversationIntent> {
    const agent = await this.validateAgentDispatch(req, signal)
    return {
      kind: ConversationHistoryAdapterKind.Agent,
      request: req,
      context: ctx,
      executionModelIds: ctx.hasLiveStream ? [] : [agent.uniqueModelId],
      agent
    }
  }

  async revalidateCommittedInput(
    request: MainDispatchRequest,
    committedValidation: ValidatedConversationIntent,
    context: ConversationIntentValidationContext,
    signal: AbortSignal
  ): Promise<ValidatedConversationIntent> {
    const current = await this.validateIntent(request, context, signal)
    if (
      committedValidation.kind !== ConversationHistoryAdapterKind.Agent ||
      current.kind !== ConversationHistoryAdapterKind.Agent ||
      committedValidation.agent.agentId !== current.agent.agentId
    ) {
      return current
    }
    const committed = committedValidation.agent
    return {
      ...current,
      agent: {
        ...current.agent,
        agentName: committed.agentName,
        reasoningEffort: committed.reasoningEffort,
        fastMode: committed.fastMode,
        headless: committed.headless,
        messageSnapshot: {
          ...committed.messageSnapshot,
          model: current.agent.messageSnapshot.model
        }
      }
    }
  }

  validateInputFailure(
    request: MainDispatchRequest,
    error: SerializedError,
    committedValidation?: ValidatedConversationIntent
  ): ValidatedConversationInputFailure | undefined {
    if (committedValidation?.kind !== ConversationHistoryAdapterKind.Agent) return undefined
    const validated = committedValidation.agent
    const userMessage = request.agentDeliveryMessage
    if (
      !userMessage ||
      userMessage.sessionId !== validated.sessionId ||
      userMessage.id !== validated.userMessageId ||
      request.conversation.id !== validated.sessionId
    ) {
      return undefined
    }
    return {
      kind: ConversationHistoryAdapterKind.Agent,
      request,
      error,
      executionModelIds: [validated.uniqueModelId],
      agent: validated,
      userMessage
    }
  }

  commitInputFailureIntent(validation: ValidatedConversationInputFailure): CommittedConversationIntent {
    if (validation.kind !== ConversationHistoryAdapterKind.Agent) {
      throw new Error(`Agent HistoryPort received ${validation.kind} failure validation`)
    }
    const validated = validation.agent

    const assistantMessage = agentSessionMessageService.saveMessage({
      sessionId: validated.sessionId,
      message: {
        id: uuidv7(),
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: validated.uniqueModelId,
        messageSnapshot: validated.messageSnapshot
      }
    })
    const conversation = { kind: ConversationKind.Agent, id: validated.sessionId } as const
    return {
      conversation,
      input: { historyNodeId: validation.userMessage.id },
      executions: [
        {
          modelId: validated.uniqueModelId,
          outputNodeId: assistantMessage.id,
          preparation: {
            kind: ConversationExecutionPreparationKind.Failure,
            conversation,
            error: validation.error
          },
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.Agent,
            sessionId: validated.sessionId,
            assistantMessageId: assistantMessage.id,
            modelId: validated.uniqueModelId
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Agent, runtimeTurnId: crypto.randomUUID() }
        }
      ],
      reservedMessages: [toReservedAgentUIMessage(assistantMessage)],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: [
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: validated.sessionId }
      ]
    }
  }

  commitIntent(
    validation: ValidatedConversationIntent,
    context: ConversationIntentValidationContext
  ): CommittedConversationIntent {
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

      return {
        conversation: { kind: ConversationKind.Agent, id: validated.sessionId },
        input: { historyNodeId: savedUserMessage.id },
        executions: [],
        reservedMessages: [toReservedAgentUIMessage(savedUserMessage)],
        activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
        postCommitTasks: []
      }
    }

    const persisted = application
      .get('DbService')
      .withWriteTx((tx) => this.persistDispatchTx(tx, validated, ctx?.expectedAgentId))
    return this.commitPersistedIntent(persisted)
  }

  commitBatchIntent(
    validations: readonly ValidatedConversationIntent[],
    context: ConversationIntentValidationContext
  ): CommittedConversationIntent {
    if (validations.length === 1) return this.commitIntent(validations[0], context)
    if (context.hasLiveStream || validations.length === 0) throw new Error('Agent batch requires an idle Conversation')
    const entries = validations.map((validation) => {
      if (validation.kind !== ConversationHistoryAdapterKind.Agent) {
        throw new Error('Agent batch contains another history adapter')
      }
      return validation.agent
    })
    const first = entries[0]
    if (!first) throw new Error('Agent batch is empty')
    if (
      entries.some(
        (entry) =>
          entry.sessionId !== first.sessionId ||
          entry.agentId !== first.agentId ||
          entry.agentUpdatedAt !== first.agentUpdatedAt ||
          entry.uniqueModelId !== first.uniqueModelId ||
          entry.reasoningEffort !== first.reasoningEffort ||
          entry.serviceTier !== first.serviceTier ||
          entry.fastMode !== first.fastMode ||
          entry.headless !== first.headless ||
          entry.deliveryMessage !== undefined
      )
    ) {
      throw new Error('Agent batch profile changed before commit')
    }

    const persisted = application.get('DbService').withWriteTx((tx) => {
      const assistantMessageId = uuidv7()
      const savedMessages = agentSessionMessageService.saveMessagesTx(
        tx,
        {
          sessionId: first.sessionId,
          messages: [
            ...entries.map((entry) => ({
              id: entry.userMessageId,
              role: 'user' as const,
              status: 'success' as const,
              data: { parts: entry.userMessageParts }
            })),
            {
              id: assistantMessageId,
              role: 'assistant' as const,
              status: 'pending' as const,
              data: { parts: [] },
              modelId: first.uniqueModelId,
              messageSnapshot: first.messageSnapshot
            }
          ]
        },
        { id: first.agentId, updatedAt: first.agentUpdatedAt, model: first.uniqueModelId, type: first.agentType }
      )
      const userMessages = savedMessages.filter(
        (message): message is AgentSessionMessageEntity & { role: 'user' } => message.role === 'user'
      )
      const lastUser = userMessages.at(-1)
      if (!lastUser) throw new Error('Agent batch did not commit a user row')
      const runtimeUser = {
        ...lastUser,
        data: { parts: userMessages.flatMap((message) => message.data.parts ?? []) }
      }
      return {
        validated: first,
        assistantMessageId,
        traceId: agentSessionService.ensureTraceIdTx(tx, first.sessionId),
        userMessage: runtimeUser,
        savedMessages
      } satisfies PersistedAgentDispatch
    })
    return this.commitPersistedIntent(persisted)
  }

  async prepareExecutionContext(
    descriptor: ConversationExecutionPreparationDescriptor,
    signal: AbortSignal
  ): Promise<ConversationExecutionContext> {
    if (descriptor.kind === ConversationExecutionPreparationKind.Failure) {
      signal.throwIfAborted()
      const failure = new Error(descriptor.error.message ?? 'Agent continuation failed')
      failure.name = descriptor.error.name ?? 'Error'
      if (descriptor.error.stack) failure.stack = descriptor.error.stack
      throw failure
    }
    if (
      descriptor.kind !== ConversationExecutionPreparationKind.AgentFresh &&
      descriptor.kind !== ConversationExecutionPreparationKind.AgentRuntime
    ) {
      throw new Error(`Agent HistoryPort cannot prepare ${descriptor.kind}`)
    }
    signal.throwIfAborted()
    return {
      conversation: descriptor.conversation,
      models: [
        {
          modelId: descriptor.modelId,
          request: {
            chatId: descriptor.conversation.id,
            trigger: ConversationOpenTrigger.SubmitMessage,
            assistantId: descriptor.agentId,
            uniqueModelId: descriptor.modelId,
            messageId: descriptor.outputNodeId,
            messages: [
              {
                id: descriptor.userMessage.id,
                role: 'user',
                parts: descriptor.userMessage.data.parts ?? []
              },
              { id: descriptor.outputNodeId, role: 'assistant', parts: [] }
            ],
            reasoningEffort: descriptor.reasoningEffort,
            serviceTier: descriptor.serviceTier,
            ...(descriptor.fastMode ? { fastMode: true } : {}),
            runtime: {
              kind: AiRuntimeKind.AgentSession,
              sessionId: descriptor.conversation.id,
              turnId: descriptor.runtimeTurnId
            }
          }
        }
      ]
    }
  }

  async persistTerminal(
    descriptor: ConversationTerminalPersistenceDescriptor,
    terminal: ConversationTerminalWrite
  ): Promise<void> {
    if (descriptor.kind !== ConversationTerminalPersistenceKind.Agent) {
      throw new Error(`Agent HistoryPort cannot persist ${descriptor.kind}`)
    }
    const port = new PersistenceListener({
      topicId: descriptor.sessionId,
      modelId: descriptor.modelId,
      backend: new AgentSessionMessageBackend({
        sessionId: descriptor.sessionId,
        assistantMessageId: descriptor.assistantMessageId,
        modelId: descriptor.modelId,
        runtimeResumeToken: terminal.runtimeCheckpoint?.runtimeResumeToken
      })
    })
    if (terminal.status === ConversationOutcomeKind.Success) await port.onDone(terminal)
    else if (terminal.status === ConversationOutcomeKind.Paused) await port.onPaused(terminal)
    else await port.onError(terminal)
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
