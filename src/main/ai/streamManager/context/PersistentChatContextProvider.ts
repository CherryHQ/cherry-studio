/**
 * Default provider for SQLite-backed topics. Catch-all in the dispatcher
 * array — keep it last. Reads topic/assistant/model, persists user msg
 * + placeholders, builds history from the tree path, assembles
 * per-execution `PersistenceListener`s.
 */

import { ContextPrompts, resolveCompressionOutputTokens, summarizeModelMessages } from '@cherrystudio/ai-core'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import {
  COMPACTION_INPUT_SAFETY_RATIO,
  COMPACTION_MIN_INPUT_BUDGET,
  CONTEXT_COMPACT_KEEP_BUDGET_RATIO,
  CONTEXT_COMPACT_TRIGGER_RATIO
} from '@main/ai/constants'
import { collectFileAttachments } from '@main/ai/messages/attachmentRouting'
import { collectPersistedOutputPaths } from '@main/ai/messages/persistedOutputRendering'
import { collectRetainedContext, type RetainedContext } from '@main/ai/messages/retainedContext'
import { messageService } from '@main/data/services/MessageService'
import { providerService } from '@main/data/services/ProviderService'
import { compactionAnchorChunkId, type CompactionAnchorData, type CompactionSink } from '@shared/ai/compaction'
import {
  ConversationActiveNodeMove,
  ConversationAdmissionReason,
  ConversationContinuationTrigger,
  ConversationKind,
  ConversationOpenTrigger,
  ConversationOutcomeKind,
  type ConversationRef,
  ConversationTargetMode
} from '@shared/ai/conversation'
import { applyApprovalDecisions, type ApprovalDecision } from '@shared/ai/transport'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { ContextSettingsOverride } from '@shared/data/types/contextSettings'
import {
  type AssistantTurnOptions,
  type Message as SharedMessage,
  type MessageRole,
  type MessageSnapshot,
  toContentRole
} from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { getKnowledgeBaseIdsFromParts, hasClearContextPart } from '@shared/data/types/uiParts'
import type { SerializedError } from '@shared/types/error'
import { isToolUIPart, type ModelMessage, type UIMessage } from 'ai'
import { v7 as uuidv7 } from 'uuid'

import { resolveMinContextWindow } from '../../contextBuild/resolveContextWindow'
import { resolveInputRoom } from '../../contextBuild/resolveInputRoom'
import { resolveOutputReservation } from '../../contextBuild/resolveOutputReservation'
import { resolveRequestContextSettings } from '../../contextBuild/resolveRequestContextSettings'
import { ConversationAdmissionError } from '../../conversation'
import { applyMaxMessagesWindow } from '../../messages/maxMessagesWindow'
import { toModelMessages } from '../../messages/messageRules'
import { wrapSteerReminder } from '../../steerReminder'
import { resolveModelTokenDialect, type TokenDialect } from '../../tokens/dialect'
import type { AiStreamRequest } from '../../types'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { MessageServiceBackend } from '../persistence/backends/MessageServiceBackend'
import { finalizeInterruptedParts } from '../persistence/PersistenceBackend'
import type { CherryUIMessage } from '../types'
import {
  applyDeepestMarker,
  type CompactionRow,
  estimateRowTokens,
  findDeepestMarker,
  planKeepBoundary,
  summaryRow
} from './compaction'
import {
  type CommittedConversationIntent,
  ConversationAfterPersistTaskKind,
  type ConversationCrashRecoveryResult,
  type ConversationExecutionContext,
  ConversationExecutionDriverBindingKind,
  ConversationExecutionMutationKind,
  type ConversationExecutionPreparationDescriptor,
  ConversationExecutionPreparationKind,
  ConversationHistoryAdapterKind,
  type ConversationHistoryPort,
  type ConversationIntentValidationContext,
  type ConversationInteractionCommitResult,
  ConversationInteractionCommitResultKind,
  ConversationPostCommitTaskKind,
  ConversationTelemetryKind,
  type ConversationTerminalPersistenceDescriptor,
  ConversationTerminalPersistenceKind,
  type ConversationTerminalWrite,
  type ValidatedConversationInputFailure,
  type ValidatedConversationIntent
} from './ConversationHistoryPort'
import type { MainContinueConversationRequest, MainDispatchRequest, MainSteerContinuationRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels, resolvePersistentSiblingsGroupId } from './modelResolution'

const logger = loggerService.withContext('PersistentChatContextProvider')

/** Media cost table for the turn. Unreachable provider row → the openai table. */
function resolveRowDialect(model: Model | undefined): TokenDialect {
  if (!model) return 'openai'
  try {
    return resolveModelTokenDialect(providerService.getByProviderId(model.providerId), model)
  } catch {
    return 'openai'
  }
}

/** The topic's assistant identity, snapshotted onto its replies so the header survives deletion. */
function resolveAssistantIdentity(assistantId: string | undefined) {
  if (!assistantId) return undefined
  const a = assistantDataService.getById(assistantId)
  return { id: a.id, name: a.name, emoji: a.emoji }
}

/**
 * The assistant-layer context-settings override, snapshotted once per prepare
 * and handed to BOTH consumers (durable compaction + the persist-time trim) so
 * the two lanes stay on the same effective settings. Missing/deleted assistant
 * (incl. agent-session agentIds) degrades to "inherit globals".
 */
function resolveAssistantContextOverride(assistantId: string | undefined): ContextSettingsOverride | null | undefined {
  if (!assistantId) return undefined
  try {
    return assistantDataService.getById(assistantId).settings.contextSettings
  } catch {
    return undefined
  }
}

/** Author snapshot for an assistant reply: the assistant with its model nested inside. */
function buildAssistantMessageSnapshot(
  model: Model,
  assistant: { id: string; name: string; emoji: string } | undefined
): MessageSnapshot | undefined {
  if (!assistant) return undefined
  return {
    ...assistant,
    model: {
      id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
      name: model.name,
      provider: model.providerId
    }
  }
}

/**
 * Wrap the trailing user message's text parts in a steer system-reminder, for the model-facing
 * history copy only — the persisted user row is untouched.
 */
function withSteerReminder(history: CherryUIMessage[]): CherryUIMessage[] {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue
    const message = history[i]
    const parts = message.parts.map((part) =>
      part.type === 'text' && part.text.trim() ? { ...part, text: wrapSteerReminder(part.text) } : part
    )
    const next = history.slice()
    next[i] = { ...message, parts }
    return next
  }
  return history
}

function toReservedUIMessage(message: SharedMessage): CherryUIMessage {
  return {
    id: message.id,
    role: toContentRole(message.role),
    parts: message.data.parts ?? [],
    metadata: {
      parentId: message.parentId,
      siblingsGroupId: message.siblingsGroupId || undefined,
      modelId: message.modelId ?? undefined,
      messageSnapshot: message.messageSnapshot ?? undefined,
      status: message.status,
      turnOptions: message.data.turnOptions,
      createdAt: message.createdAt,
      stats: message.stats ?? undefined,
      isActiveBranch: true,
      ...(message.stats?.totalTokens ? { totalTokens: message.stats.totalTokens } : {})
    }
  } satisfies CherryUIMessage
}

function assertUniqueMentionedModelIds(modelIds: readonly UniqueModelId[] | undefined): void {
  if (modelIds && new Set(modelIds).size !== modelIds.length) {
    throw new Error('mentionedModelIds must not contain duplicate model ids')
  }
}

export class PersistentChatContextProvider implements ConversationHistoryPort {
  readonly name = 'persistent'
  readonly isPersistentConversation = true

  recoverCrashOrphans(): ConversationCrashRecoveryResult {
    const stale = messageService.findCrashOrphanedAssistantMessages()
    if (stale.length === 0) return { repairedOutputs: [] }
    messageService.resolveCrashOrphanedMessages(
      stale.map(({ id, data }) => ({
        id,
        data: { ...data, parts: finalizeInterruptedParts(data.parts ?? [], ConversationOutcomeKind.Error) }
      }))
    )
    return { repairedOutputs: stale.map(({ id }) => ({ outputNodeId: id, status: 'error' })) }
  }

  commitInteractionDecision(anchorId: string, decision: ApprovalDecision): ConversationInteractionCommitResult {
    const result = messageService.applyToolApprovalDecisions(anchorId, [decision])
    if (!result) return { kind: ConversationInteractionCommitResultKind.Missing }
    const continuation = result.parts.some((part) => isToolUIPart(part) && part.state === 'approval-requested')
      ? ConversationInteractionCommitResultKind.Pending
      : ConversationInteractionCommitResultKind.Ready
    if (result.appliedApprovalIds.length === 0 && result.alreadySettledApprovalIds.includes(decision.approvalId)) {
      return { kind: ConversationInteractionCommitResultKind.Duplicate, continuation }
    }
    return { kind: continuation }
  }

  validateInputFailure(
    request: MainDispatchRequest,
    error: SerializedError
  ): ValidatedConversationInputFailure | undefined {
    if (request.trigger !== ConversationContinuationTrigger.ContinueSteer) return undefined

    const userMessage = messageService.getById(request.userMessageId)
    if (userMessage.topicId !== request.conversation.id || userMessage.role !== 'user' || !userMessage.modelId) {
      return undefined
    }

    const modelId = userMessage.modelId as UniqueModelId
    const [resolvedModel] = resolveModels([modelId], modelId)
    if (!resolvedModel) return undefined
    return {
      kind: ConversationHistoryAdapterKind.PersistentChat,
      request,
      error,
      executionModelIds: [modelId],
      resolvedModel,
      assistantId: topicService.getById(request.conversation.id)?.assistantId
    }
  }

  commitInputFailureIntent(validation: ValidatedConversationInputFailure): CommittedConversationIntent {
    if (validation.kind !== ConversationHistoryAdapterKind.PersistentChat) {
      throw new Error(`Persistent Chat received ${validation.kind} failure validation`)
    }
    const committed = this.commitSteerContinuation(validation.request, validation.assistantId, [
      validation.resolvedModel
    ])
    return {
      ...committed,
      executions: committed.executions.map((execution) => ({
        ...execution,
        preparation: {
          kind: ConversationExecutionPreparationKind.Failure,
          conversation: committed.conversation,
          error: validation.error
        }
      }))
    }
  }

  /** Default provider — matches any topic not claimed by a more specific provider. */
  canHandle(conversation: ConversationRef): boolean {
    return conversation.kind === ConversationKind.Chat
  }

  async validateIntent(
    req: MainDispatchRequest,
    ctx: ConversationIntentValidationContext,
    signal: AbortSignal
  ): Promise<ValidatedConversationIntent> {
    signal.throwIfAborted()
    assertUniqueMentionedModelIds('mentionedModelIds' in req ? req.mentionedModelIds : undefined)
    const topic = topicService.getById(req.conversation.id)
    if (req.trigger === ConversationOpenTrigger.AppendModel && !ctx.hasLiveStream) {
      throw new ConversationAdmissionError(ConversationAdmissionReason.TargetNotInLiveGroup)
    }
    const selectedModelId = 'mentionedModelIds' in req ? req.mentionedModelIds?.[0] : undefined
    let assistantId = topic?.assistantId
    let resolvedDefaultModelId: UniqueModelId | undefined
    const defaultModelId = (): UniqueModelId => {
      if (selectedModelId) return selectedModelId
      if (resolvedDefaultModelId) return resolvedDefaultModelId
      const resolved = resolveAssistantModelId(topic?.assistantId)
      assistantId = resolved.assistantId
      resolvedDefaultModelId = resolved.defaultModelId
      return resolvedDefaultModelId
    }
    let inputModelId: UniqueModelId
    let resolvedModels
    if (ctx.hasLiveStream && req.trigger === ConversationOpenTrigger.SubmitMessage) {
      inputModelId = defaultModelId()
      resolvedModels = []
    } else if (req.trigger === ConversationContinuationTrigger.ContinueInteraction) {
      const anchor = messageService.getById(req.parentAnchorId)
      const modelId = (anchor.modelId ?? defaultModelId()) as UniqueModelId
      inputModelId = modelId
      resolvedModels = resolveModels([modelId], modelId)
    } else if (req.trigger === ConversationContinuationTrigger.ContinueSteer) {
      const userMessage = messageService.getById(req.userMessageId)
      const modelId = (userMessage.modelId ?? defaultModelId()) as UniqueModelId
      inputModelId = modelId
      resolvedModels = resolveModels([modelId], modelId)
    } else if (req.trigger === ConversationOpenTrigger.RetryMessage) {
      const target = messageService.getById(req.retryMessageId)
      const modelId = (target.modelId ?? defaultModelId()) as UniqueModelId
      inputModelId = modelId
      resolvedModels = resolveModels([modelId], modelId)
    } else {
      inputModelId = defaultModelId()
      resolvedModels = resolveModels(req.mentionedModelIds, inputModelId)
    }
    let liveExecutionMutation
    if (
      ctx.hasLiveStream &&
      (req.trigger === ConversationOpenTrigger.RetryMessage || req.trigger === ConversationOpenTrigger.AppendModel)
    ) {
      const parentNodeId = req.parentAnchorId
      const outputNodeId =
        req.trigger === ConversationOpenTrigger.RetryMessage ? req.retryMessageId : req.appendToLiveGroupMessageId
      if (!parentNodeId || !outputNodeId) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.ConversationBusy)
      }
      if (resolvedModels.length !== 1) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.SingleModelRequired)
      }
      const siblingsGroupId = resolvePersistentSiblingsGroupId(resolvedModels, true, parentNodeId)
      if (siblingsGroupId === undefined) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.TargetNotInLiveGroup)
      }
      let target: SharedMessage
      try {
        target = messageService.getById(outputNodeId)
      } catch (error) {
        if (!(error instanceof DataApiError) || error.code !== ErrorCode.NOT_FOUND) throw error
        throw new ConversationAdmissionError(ConversationAdmissionReason.TargetNotInLiveGroup)
      }
      if (
        target.topicId !== req.conversation.id ||
        target.role !== 'assistant' ||
        target.parentId !== parentNodeId ||
        (target.siblingsGroupId !== 0 && target.siblingsGroupId !== siblingsGroupId)
      ) {
        throw new ConversationAdmissionError(ConversationAdmissionReason.TargetNotInLiveGroup)
      }
      liveExecutionMutation = {
        kind:
          req.trigger === ConversationOpenTrigger.RetryMessage
            ? ConversationExecutionMutationKind.Retry
            : ConversationExecutionMutationKind.Append,
        outputNodeId,
        parentNodeId,
        siblingsGroupId,
        persistedSiblingsGroupId: target.siblingsGroupId
      }
    }
    return {
      kind: ConversationHistoryAdapterKind.PersistentChat,
      request: req,
      context: ctx,
      executionModelIds: resolvedModels.map((model) => model.id),
      resolvedModels,
      assistantId,
      inputModelId,
      liveExecutionMutation
    }
  }

  commitIntent(
    validation: ValidatedConversationIntent,
    context: ConversationIntentValidationContext
  ): CommittedConversationIntent {
    if (validation.kind !== ConversationHistoryAdapterKind.PersistentChat) {
      throw new Error(`Persistent Chat received ${validation.kind} validation`)
    }
    const req = validation.request
    const ctx = context

    const assistantId = validation.assistantId
    // A failed assistant retry is identity-preserving: reset and rerun the exact row so its
    // sibling position, descendants, and the topic's active branch remain untouched.
    if (req.trigger === ConversationOpenTrigger.RetryMessage) {
      return this.commitAssistantRetry(req, assistantId, validation.resolvedModels)
    }

    // continue-conversation reuses the existing assistant anchor — no new placeholder, no multi-model.
    if (req.trigger === ConversationContinuationTrigger.ContinueInteraction) {
      return this.commitContinueDispatch(req, assistantId, validation.resolvedModels)
    }

    // steer-continuation answers a steer user message persisted while a turn was live — a fresh
    // assistant placeholder under that user row (no new user row), single model.
    if (req.trigger === ConversationContinuationTrigger.ContinueSteer) {
      return this.commitSteerContinuation(req, assistantId, validation.resolvedModels)
    }

    const defaultModelId = validation.inputModelId
    const hasExplicitReservedTarget =
      req.trigger === ConversationOpenTrigger.SubmitMessage && req.targetMode === ConversationTargetMode.ReservedBranch
    const reservedBranchId =
      req.trigger === ConversationOpenTrigger.SubmitMessage &&
      req.parentAnchorId &&
      (hasExplicitReservedTarget ||
        (req.targetMode === undefined && messageService.isAwaitingInputLeaf(req.parentAnchorId, req.conversation.id)))
        ? req.parentAnchorId
        : undefined

    if (hasExplicitReservedTarget && !reservedBranchId) {
      throw new Error("'reserved-branch' target requires parentAnchorId")
    }

    if (ctx.hasLiveStream && req.trigger === ConversationOpenTrigger.SubmitMessage) {
      // A reserved branch belongs to another tree path and must never be injected as a steer
      // into the topic's running turn. Renderer queues it until idle; this synchronous check
      // is the main-process race backstop and performs no writes on rejection.
      if (hasExplicitReservedTarget || reservedBranchId) {
        throw new Error('Cannot submit a reserved branch while a stream is live on this topic')
      }

      // Stamp the row with the model the user selected for this steer so the continuation answers
      // with it — `prepareSteerContinuation` reads `userMessage.modelId`. Steer is single-model: if
      // multiple models were @-mentioned, only the first is used (multi-model steer is unsupported).
      const steerModelId = req.mentionedModelIds?.[0] ?? defaultModelId
      const userMessage = messageService.create(req.conversation.id, {
        role: 'user',
        parentId: req.parentAnchorId,
        data: { parts: req.userMessageParts },
        status: 'success',
        // User rows carry only `modelId` (read by steer-continuation); the author snapshot
        // lives on the assistant reply, which is what the header renders.
        modelId: steerModelId
      })

      return {
        conversation: req.conversation,
        input: {
          historyNodeId: userMessage.id,
          pendingSteerReasoningEffort: req.reasoningEffort,
          pendingSteerServiceTier: req.serviceTier,
          pendingSteerFastMode: req.fastMode === true
        },
        executions: [],
        reservedMessages: [toReservedUIMessage(userMessage)],
        activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
        postCommitTasks: []
      }
    }

    // 3. Models (single or multi)
    const isRegenerate =
      req.trigger === ConversationOpenTrigger.RegenerateMessage || req.trigger === ConversationOpenTrigger.AppendModel
    const models = validation.resolvedModels
    const liveExecutionMutation = validation.liveExecutionMutation
    const liveGroupSourceAnchorMessageId =
      liveExecutionMutation?.kind === ConversationExecutionMutationKind.Append
        ? liveExecutionMutation.outputNodeId
        : undefined
    const turnOptions: AssistantTurnOptions = {
      reasoningEffort: req.reasoningEffort,
      serviceTier: req.serviceTier,
      fastMode: req.fastMode === true
    }

    if (isRegenerate && !req.parentAnchorId) {
      throw new Error(`'regenerate-message' requires parentAnchorId`)
    }

    // Pure compute; backfill happens inside the reservation tx. Resolver short-circuits
    // for non-regenerate, so passing undefined parentAnchorId is harmless.
    const siblingsGroupId =
      liveExecutionMutation?.siblingsGroupId ??
      resolvePersistentSiblingsGroupId(models, isRegenerate, req.parentAnchorId ?? '')
    const assistantIdentity = resolveAssistantIdentity(assistantId)
    const plannedUserMessageId =
      req.trigger === ConversationOpenTrigger.SubmitMessage ? (reservedBranchId ?? uuidv7()) : req.parentAnchorId

    // User message + N placeholders in one tx — SQLite rolls back on any failure.
    const userMessageInput =
      req.trigger === ConversationOpenTrigger.SubmitMessage
        ? reservedBranchId
          ? ({
              mode: 'fill-reserved' as const,
              id: reservedBranchId,
              data: { parts: req.userMessageParts },
              modelId: defaultModelId
            } as const)
          : ({
              mode: 'create' as const,
              id: plannedUserMessageId,
              dto: {
                role: 'user' as const,
                parentId: req.parentAnchorId,
                data: { parts: req.userMessageParts },
                status: 'success' as const,
                modelId: defaultModelId
              }
            } as const)
        : ({ mode: 'existing' as const, id: req.parentAnchorId } as const)

    const containerTraceId = topicService.ensureTraceId(req.conversation.id)
    const contextSettingsOverride = resolveAssistantContextOverride(assistantId)
    const committed = messageService.createUserMessageWithPlaceholders({
      topicId: req.conversation.id,
      userMessage: userMessageInput,
      siblingsGroupId,
      activeNodeDecision: liveGroupSourceAnchorMessageId ? { move: 'keep' } : { move: 'advance' },
      placeholders: models.map((model) => ({
        role: 'assistant',
        data: { parts: [], turnOptions },
        status: 'pending',
        modelId: model.id,
        messageSnapshot: buildAssistantMessageSnapshot(model, assistantIdentity)
      }))
    })
    const { userMessage, placeholders } = committed
    const shouldAutoNameInitialTurn = !isRegenerate && !req.parentAnchorId
    if (liveGroupSourceAnchorMessageId && (!req.parentAnchorId || siblingsGroupId === undefined)) {
      throw new ConversationAdmissionError(ConversationAdmissionReason.TargetNotInLiveGroup)
    }
    const shouldKeepActiveNode =
      liveGroupSourceAnchorMessageId && req.parentAnchorId && siblingsGroupId !== undefined ? true : undefined
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.PersistentChat,
      conversation: req.conversation,
      models,
      outputNodeIds: placeholders.map(({ id }) => id),
      historyAnchorId: userMessage.id,
      assistantId,
      contextSettingsOverride,
      turnOptions,
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? []),
      steerReminder: false
    }
    return {
      conversation: req.conversation,
      input: { historyNodeId: userMessage.id },
      executions: models.map((model, index) => {
        const placeholder = placeholders[index]
        if (!placeholder) throw new Error('History transaction returned fewer placeholders than models')
        return {
          modelId: model.id,
          outputNodeId: placeholder.id,
          preparation,
          preparationIndex: index,
          persistence: {
            kind: ConversationTerminalPersistenceKind.PersistentChat,
            topicId: req.conversation.id,
            modelId: model.id,
            assistantMessageId: placeholder.id,
            turnOptions,
            contextSettingsOverride
          },
          ...(shouldAutoNameInitialTurn && index === 0
            ? {
                afterPersist: {
                  kind: ConversationAfterPersistTaskKind.RenameChatFromSummary,
                  topicId: req.conversation.id,
                  assistantId,
                  userMessageId: userMessage.id
                }
              }
            : {}),
          telemetry: {
            kind: ConversationTelemetryKind.Chat,
            topicId: req.conversation.id,
            trigger: req.trigger,
            traceId: containerTraceId,
            modelId: model.id,
            modelName: model.name ?? model.id
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Chat }
        }
      }),
      reservedMessages: [userMessage, ...placeholders].map(toReservedUIMessage),
      activeNodeDecision: {
        move: shouldKeepActiveNode ? ConversationActiveNodeMove.Keep : ConversationActiveNodeMove.Advance
      },
      postCommitTasks: [
        ...(shouldAutoNameInitialTurn
          ? [
              {
                kind: ConversationPostCommitTaskKind.RenameChatFromFirstUser as const,
                topicId: req.conversation.id,
                userMessageId: userMessage.id
              }
            ]
          : []),
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: req.conversation.id }
      ]
    }
  }

  commitBatchIntent(
    validations: readonly ValidatedConversationIntent[],
    context: ConversationIntentValidationContext
  ): CommittedConversationIntent {
    if (validations.length === 1) return this.commitIntent(validations[0], context)
    if (context.hasLiveStream || validations.length === 0) throw new Error('Chat batch requires an idle Conversation')
    const entries = validations.map((validation) => {
      if (
        validation.kind !== ConversationHistoryAdapterKind.PersistentChat ||
        validation.request.trigger !== ConversationOpenTrigger.SubmitMessage
      ) {
        throw new Error('Chat batch contains a non-submit validation')
      }
      return { ...validation, request: validation.request }
    })
    const first = entries[0]
    if (!first) throw new Error('Chat batch is empty')
    const topicId = first.request.conversation.id
    const modelIds = first.executionModelIds.join('\0')
    if (
      entries.some(
        (entry) =>
          entry.request.conversation.id !== topicId ||
          entry.executionModelIds.join('\0') !== modelIds ||
          entry.assistantId !== first.assistantId ||
          entry.request.targetMode === ConversationTargetMode.ReservedBranch
      )
    ) {
      throw new Error('Chat batch profile changed before commit')
    }

    const models = first.resolvedModels
    const turnOptions: AssistantTurnOptions = {
      reasoningEffort: first.request.reasoningEffort,
      serviceTier: first.request.serviceTier,
      fastMode: first.request.fastMode === true
    }
    const assistantIdentity = resolveAssistantIdentity(first.assistantId)
    const committed = messageService.createUserMessageBatchWithPlaceholders({
      topicId,
      parentId: first.request.parentAnchorId,
      users: entries.map((entry) => ({
        data: { parts: entry.request.userMessageParts },
        modelId: entry.inputModelId
      })),
      placeholders: models.map((model) => ({
        role: 'assistant',
        data: { parts: [], turnOptions },
        status: 'pending',
        modelId: model.id,
        messageSnapshot: buildAssistantMessageSnapshot(model, assistantIdentity)
      }))
    })
    const anchor = committed.userMessages.at(-1)
    if (!anchor) throw new Error('Chat batch did not commit a user row')
    const contextSettingsOverride = resolveAssistantContextOverride(first.assistantId)
    const traceId = topicService.ensureTraceId(topicId)
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.PersistentChat,
      conversation: first.request.conversation,
      models,
      outputNodeIds: committed.placeholders.map(({ id }) => id),
      historyAnchorId: anchor.id,
      assistantId: first.assistantId,
      contextSettingsOverride,
      turnOptions,
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(anchor.data.parts ?? []),
      steerReminder: false
    }
    const shouldAutoName = !first.request.parentAnchorId
    return {
      conversation: first.request.conversation,
      input: { historyNodeId: anchor.id },
      executions: models.map((model, index) => {
        const placeholder = committed.placeholders[index]
        if (!placeholder) throw new Error('Chat batch returned fewer placeholders than models')
        return {
          modelId: model.id,
          outputNodeId: placeholder.id,
          preparation,
          preparationIndex: index,
          persistence: {
            kind: ConversationTerminalPersistenceKind.PersistentChat,
            topicId,
            modelId: model.id,
            assistantMessageId: placeholder.id,
            turnOptions,
            contextSettingsOverride
          },
          telemetry: {
            kind: ConversationTelemetryKind.Chat,
            topicId,
            trigger: ConversationOpenTrigger.SubmitMessage,
            traceId,
            modelId: model.id,
            modelName: model.name ?? model.id
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Chat }
        }
      }),
      reservedMessages: [...committed.userMessages, ...committed.placeholders].map(toReservedUIMessage),
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: [
        ...(shouldAutoName
          ? [
              {
                kind: ConversationPostCommitTaskKind.RenameChatFromFirstUser as const,
                topicId,
                userMessageId: committed.userMessages[0]?.id ?? anchor.id
              }
            ]
          : []),
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: topicId }
      ]
    }
  }

  private commitAssistantRetry(
    req: Extract<MainDispatchRequest, { trigger: ConversationOpenTrigger.RetryMessage }>,
    assistantId: string | undefined,
    resolvedModels: readonly Model[]
  ): CommittedConversationIntent {
    const target = messageService.getById(req.retryMessageId)
    if (target.role !== 'assistant') {
      throw new Error(`'retryMessageId' must identify an assistant message (got '${target.role}')`)
    }
    if (target.topicId !== req.conversation.id || target.parentId !== req.parentAnchorId) {
      throw new Error('Retry target does not belong to the requested topic/user anchor')
    }
    const parent = messageService.getById(req.parentAnchorId)
    if (parent.role !== 'user' || parent.topicId !== req.conversation.id) {
      throw new Error(`'regenerate-message' parentAnchorId must identify a user message in the topic`)
    }

    const [model] = resolvedModels
    if (!model || resolvedModels.length !== 1 || (target.modelId && model.id !== target.modelId)) {
      throw new Error('Retry validation no longer matches the target model')
    }
    const targetModelId = model.id
    if (req.mentionedModelIds && (req.mentionedModelIds.length !== 1 || req.mentionedModelIds[0] !== targetModelId)) {
      throw new Error('In-place retry cannot change the assistant model')
    }
    const turnOptions: AssistantTurnOptions = {
      reasoningEffort: req.reasoningEffort ?? target.data.turnOptions?.reasoningEffort,
      serviceTier: req.serviceTier ?? target.data.turnOptions?.serviceTier,
      fastMode: req.fastMode ?? target.data.turnOptions?.fastMode ?? false
    }
    const contextSettingsOverride = resolveAssistantContextOverride(assistantId)
    const containerTraceId = topicService.ensureTraceId(req.conversation.id)
    const resetMessage = messageService.resetAssistantForRetry(target.id)
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.PersistentChat,
      conversation: req.conversation,
      models: [model],
      outputNodeIds: [target.id],
      historyAnchorId: parent.id,
      assistantId,
      contextSettingsOverride,
      turnOptions,
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(parent.data.parts ?? []),
      steerReminder: false
    }
    return {
      conversation: req.conversation,
      input: { historyNodeId: parent.id },
      executions: [
        {
          modelId: model.id,
          outputNodeId: target.id,
          seedFromEmpty: true,
          preparation,
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.PersistentChat,
            topicId: req.conversation.id,
            modelId: model.id,
            assistantMessageId: target.id,
            turnOptions,
            contextSettingsOverride
          },
          telemetry: {
            kind: ConversationTelemetryKind.Chat,
            topicId: req.conversation.id,
            trigger: req.trigger,
            traceId: containerTraceId,
            modelId: model.id,
            modelName: model.name ?? model.id
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Chat }
        }
      ],
      reservedMessages: [toReservedUIMessage(resetMessage)],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: [
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: req.conversation.id }
      ]
    }
  }

  /**
   * Resume an assistant turn paused on tool-approval. Reuses the existing
   * row (no new placeholder, no sibling group). Renderer sends decisions
   * only; Main applies them to DB-authoritative parts. Backend's
   * `assistantMessageId === anchor.id` makes the terminal write an update.
   */
  private commitContinueDispatch(
    req: MainContinueConversationRequest,
    assistantId: string | undefined,
    resolvedModels: readonly Model[]
  ): CommittedConversationIntent {
    const anchor = messageService.getById(req.parentAnchorId)
    if (anchor.role !== 'assistant') {
      throw new Error(`'continue-conversation' anchor must be an assistant message (got '${anchor.role}')`)
    }
    if (anchor.topicId !== req.conversation.id) {
      throw new Error(`'continue-conversation' anchor does not belong to topic ${req.conversation.id}`)
    }
    const knowledgeBaseIds = anchor.parentId
      ? getKnowledgeBaseIdsFromParts(messageService.getById(anchor.parentId).data.parts ?? [])
      : undefined

    // Apply decisions to DB parts and flip status to `pending` so resolveCompactedHistory sees the approved state.
    const beforeParts = anchor.data.parts ?? []
    const updatedParts = applyApprovalDecisions(beforeParts, req.approvalDecisions)
    // Continue uses the original assistant's model — switching mid-approval invalidates approval semantics.
    // `anchor.modelId` is nullable; coalesce null/undefined away first, then a single boundary cast.
    const [model] = resolvedModels
    if (!model || resolvedModels.length !== 1 || (anchor.modelId && model.id !== anchor.modelId)) {
      throw new Error('Interaction validation no longer matches the anchor model')
    }

    const containerTraceId = topicService.ensureTraceId(req.conversation.id)
    const contextSettingsOverride = resolveAssistantContextOverride(assistantId)
    messageService.update(req.parentAnchorId, {
      data: { ...anchor.data, parts: updatedParts },
      status: 'pending'
    })
    const turnOptions: AssistantTurnOptions = { ...anchor.data.turnOptions }
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.PersistentChat,
      conversation: req.conversation,
      models: [model],
      outputNodeIds: [anchor.id],
      historyAnchorId: anchor.id,
      assistantId,
      contextSettingsOverride,
      turnOptions,
      knowledgeBaseIds,
      steerReminder: false
    }
    return {
      conversation: req.conversation,
      input: { historyNodeId: anchor.parentId ?? anchor.id },
      executions: [
        {
          modelId: model.id,
          outputNodeId: anchor.id,
          runtimeTimingSeed: anchor.stats?.runtimeTiming,
          preparation,
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.PersistentChat,
            topicId: req.conversation.id,
            modelId: model.id,
            assistantMessageId: anchor.id,
            turnOptions,
            contextSettingsOverride
          },
          telemetry: {
            kind: ConversationTelemetryKind.Chat,
            topicId: req.conversation.id,
            trigger: req.trigger,
            traceId: containerTraceId,
            modelId: model.id,
            modelName: model.name ?? model.id
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Chat }
        }
      ],
      reservedMessages: [],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: [
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: req.conversation.id }
      ]
    }
  }

  /**
   * Prepare a queued Chat input when ConversationRuntimeService opens its successor turn.
   * Creates a fresh assistant placeholder under the steer user row (no new user row) and wraps that
   * trailing user message with a steer system-reminder in the model-facing history only.
   */
  private commitSteerContinuation(
    req: MainSteerContinuationRequest,
    assistantId: string | undefined,
    resolvedModels: readonly Model[]
  ): CommittedConversationIntent {
    const userMessage = messageService.getById(req.userMessageId)
    if (userMessage.role !== 'user') {
      throw new Error(`'steer-continuation' anchor must be a user message (got '${userMessage.role}')`)
    }
    if (userMessage.topicId !== req.conversation.id) {
      throw new Error(`'steer-continuation' anchor does not belong to topic ${req.conversation.id}`)
    }

    const [model] = resolvedModels
    if (!model || resolvedModels.length !== 1 || (userMessage.modelId && model.id !== userMessage.modelId)) {
      throw new Error('Steer validation no longer matches the input model')
    }
    const messageSnapshot = buildAssistantMessageSnapshot(model, resolveAssistantIdentity(assistantId))
    const turnOptions: AssistantTurnOptions = {
      reasoningEffort: req.reasoningEffort,
      serviceTier: req.serviceTier,
      fastMode: req.fastMode
    }

    const containerTraceId = topicService.ensureTraceId(req.conversation.id)
    const contextSettingsOverride = resolveAssistantContextOverride(assistantId)
    const committed = messageService.createUserMessageWithPlaceholders({
      topicId: req.conversation.id,
      userMessage: { mode: 'existing', id: req.userMessageId },
      activeNodeDecision: { move: 'advance' },
      placeholders: [
        {
          role: 'assistant',
          data: { parts: [], turnOptions },
          status: 'pending',
          modelId: model.id,
          messageSnapshot
        }
      ]
    })
    const placeholder = committed.placeholders[0]
    if (!placeholder) throw new Error('History transaction did not create the steer assistant placeholder')
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.PersistentChat,
      conversation: req.conversation,
      models: [model],
      outputNodeIds: [placeholder.id],
      historyAnchorId: req.userMessageId,
      assistantId,
      contextSettingsOverride,
      turnOptions,
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? []),
      steerReminder: true
    }
    return {
      conversation: req.conversation,
      input: { historyNodeId: req.userMessageId },
      executions: [
        {
          modelId: model.id,
          outputNodeId: placeholder.id,
          preparation,
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.PersistentChat,
            topicId: req.conversation.id,
            modelId: model.id,
            assistantMessageId: placeholder.id,
            turnOptions,
            contextSettingsOverride
          },
          telemetry: {
            kind: ConversationTelemetryKind.Chat,
            topicId: req.conversation.id,
            trigger: req.trigger,
            traceId: containerTraceId,
            modelId: model.id,
            modelName: model.name ?? model.id
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Chat }
        }
      ],
      reservedMessages: [toReservedUIMessage(placeholder)],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: [
        { kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: req.conversation.id }
      ]
    }
  }

  async prepareExecutionContext(
    descriptor: ConversationExecutionPreparationDescriptor,
    signal: AbortSignal,
    compactionSink?: CompactionSink
  ): Promise<ConversationExecutionContext> {
    if (descriptor.kind === ConversationExecutionPreparationKind.Failure) {
      signal.throwIfAborted()
      const failure = new Error(descriptor.error.message ?? 'Conversation continuation failed')
      failure.name = descriptor.error.name ?? 'Error'
      if (descriptor.error.stack) failure.stack = descriptor.error.stack
      throw failure
    }
    if (descriptor.kind !== ConversationExecutionPreparationKind.PersistentChat) {
      throw new Error(`Persistent Chat cannot prepare ${descriptor.kind}`)
    }
    const { messages, retainedContext } = await this.resolveCompactedHistory(
      descriptor.historyAnchorId,
      descriptor.conversation.id,
      [...descriptor.models],
      descriptor.assistantId,
      descriptor.contextSettingsOverride,
      compactionSink,
      [],
      signal
    )
    signal.throwIfAborted()
    const history = descriptor.steerReminder ? withSteerReminder(messages) : messages
    return {
      conversation: descriptor.conversation,
      models: descriptor.models.map((model, index) => {
        const outputNodeId = descriptor.outputNodeIds[index]
        if (!outputNodeId) throw new Error('Persistent Chat preparation lost an output identity')
        return {
          modelId: model.id,
          request: this.buildStreamRequest(
            descriptor.conversation.id,
            descriptor.assistantId,
            model.id,
            history,
            outputNodeId,
            descriptor.knowledgeBaseIds ? [...descriptor.knowledgeBaseIds] : undefined,
            descriptor.turnOptions.reasoningEffort,
            descriptor.turnOptions.serviceTier,
            descriptor.turnOptions.fastMode === true,
            retainedContext
          )
        }
      })
    }
  }

  async persistTerminal(
    descriptor: ConversationTerminalPersistenceDescriptor,
    terminal: ConversationTerminalWrite
  ): Promise<void> {
    if (descriptor.kind !== ConversationTerminalPersistenceKind.PersistentChat) {
      throw new Error(`Persistent Chat cannot persist ${descriptor.kind}`)
    }
    const port = new PersistenceListener({
      topicId: descriptor.topicId,
      modelId: descriptor.modelId,
      backend: new MessageServiceBackend({
        assistantMessageId: descriptor.assistantMessageId,
        turnOptions: descriptor.turnOptions,
        contextSettingsOverride: descriptor.contextSettingsOverride
      })
    })
    if (terminal.status === ConversationOutcomeKind.Success) await port.onDone(terminal)
    else if (terminal.status === ConversationOutcomeKind.Paused) await port.onPaused(terminal)
    else await port.onError(terminal)
  }

  private toRow(m: SharedMessage): CompactionRow {
    return {
      id: m.id,
      role: m.role,
      parts: (m.data?.parts ?? []) as CompactionRow['parts'],
      compactionSummary: m.compactionSummary ?? undefined,
      contextTokens: m.stats?.contextTokens ?? undefined
    }
  }

  private toServed(row: CompactionRow): CherryUIMessage {
    // Route the role through toContentRole to keep the virtual-root guard that the
    // rest of this file relies on (a `root` row must never reach model history).
    return { id: row.id, role: toContentRole(row.role as MessageRole), parts: row.parts } as CherryUIMessage
  }

  private estimateTotal(rows: CompactionRow[], dialect: TokenDialect): number {
    return rows.reduce((s, r) => s + estimateRowTokens(r, dialect), 0)
  }

  /**
   * Trigger estimate for the served history. Anchors on the most recent assistant
   * row in the served view that carries a real contextTokens (prior turn's last-step
   * totalTokens), adding a tokenx estimate of only the rows after it. Falls back to a
   * full tokenx estimate when no anchor exists or it was folded out by the marker.
   */
  private estimateContext(effective: CompactionRow[], dialect: TokenDialect): number {
    let anchorIdx = -1
    for (let i = effective.length - 1; i >= 0; i--) {
      if (effective[i].role === 'assistant' && typeof effective[i].contextTokens === 'number') {
        anchorIdx = i
        break
      }
    }
    if (anchorIdx < 0) return this.estimateTotal(effective, dialect)
    const base = effective[anchorIdx].contextTokens as number
    const tail = effective.slice(anchorIdx + 1).reduce((s, r) => s + estimateRowTokens(r, dialect), 0)
    return base + tail
  }

  /**
   * Build the model-facing history for a turn, applying durable compaction.
   * 1. Load the full path and discard rows through the latest explicit clear-context marker.
   * 2. Preserve the remaining rows with ids/roles/compactionSummary.
   * 3. Apply the DEEPEST marker on the path (a marker not on this path is ignored
   *    → branch switches stay correct).
   * 4. If over the trigger budget AND compression is enabled, snap a new keep
   *    boundary to a `user` row, summarize everything older (folding the prior
   *    summary), persist the summary onto the new boundary row, and serve the
   *    compacted view. The tree is never structurally mutated; only a column is set.
   */
  private async resolveCompactedHistory(
    anchorMessageId: string | undefined,
    topicId: string,
    models: Model[],
    assistantId: string | undefined,
    assistantContextOverride?: ContextSettingsOverride | null,
    /** Reports the turn-start fold to the UI; absent when there is no subscriber. */
    compactionSink?: CompactionSink,
    tailRows: readonly CompactionRow[] = [],
    signal?: AbortSignal
  ): Promise<{ messages: CherryUIMessage[]; retainedContext: RetainedContext }> {
    signal?.throwIfAborted()
    // Raw path from root → anchor, preserving all Message fields (including compactionSummary).
    // getPathToNode is synchronous (better-sqlite3, main #16626) — no await.
    const messagePath = anchorMessageId ? messageService.getPathToNode(anchorMessageId) : []
    const lastClearIndex = messagePath.findLastIndex((message) => hasClearContextPart(message.data.parts))
    const rawMsgs = messagePath.slice(lastClearIndex + 1)
    // Capability state from the RAW path: compaction folds file parts and tool
    // outputs out of the served view, so scanning served messages downstream
    // would silently drop read_file for folded attachments (finding #2) and
    // fs_read for folded persisted outputs. `rawUI` is mapped ONCE and sliced
    // for the manifest prefixes below — handle dedup is a left-to-right fold,
    // so a slice's handles match the full pass only when both share this array.
    const rawUI = [
      ...rawMsgs.map((m) => ({ parts: m.data.parts ?? [] }) as UIMessage),
      ...tailRows.map((row) => ({ parts: row.parts }) as UIMessage)
    ]
    const retainedContext = collectRetainedContext(rawUI)
    const rows = [...rawMsgs.map((m) => this.toRow(m)), ...tailRows]
    // Manifest handles cover ONLY the rows folded behind the boundary: live
    // attachments still ride served messages as file parts, and scoping the
    // manifest to the folded prefix makes the summary-row bytes a pure
    // function of the boundary — attaching a file later never rewrites them
    // (provider prefix caches hold).
    const d = findDeepestMarker(rows)
    const manifestHandles = (endIdx: number) => collectFileAttachments(rawUI.slice(0, endIdx + 1)).map((a) => a.handle)
    // A folded marker's blob stays allow-listed, so the summary must name its
    // path or the model holds fs_read with no legal argument.
    const manifestPaths = (endIdx: number) => [...collectPersistedOutputPaths(rawUI.slice(0, endIdx + 1))]
    const effective = applyDeepestMarker(
      rows,
      d >= 0 ? manifestHandles(d) : undefined,
      d >= 0 ? manifestPaths(d) : undefined
    )

    // A user-drawn window, unlike a space-saving fold, must also revoke
    // read_file / fs_read access to whatever slid out of it.
    const retainedForWindow = (windowed: CompactionRow[]): RetainedContext => {
      const servedIds = new Set(windowed.map((r) => r.id))
      return collectRetainedContext(rawUI.filter((_, i) => servedIds.has(rows[i].id)))
    }

    const { contextSettings, compressionModel } = await resolveRequestContextSettings(
      models[0],
      assistantContextOverride
    )
    signal?.throwIfAborted()
    const on = contextSettings.enabled && contextSettings.compress.enabled && Boolean(compressionModel)
    const serve = (rows_: typeof effective) => ({ messages: rows_.map((r) => this.toServed(r)), retainedContext })
    // NOT gated on `contextSettings.enabled`: that switch owns the overflow
    // policy, while this decides how much history is sent at all.
    if (contextSettings.maxMessages != null) {
      // RAW rows, no compaction state: a summary covers everything up to its
      // boundary, so serving one would carry pre-window content back in.
      const windowed = applyMaxMessagesWindow(rows, contextSettings.maxMessages)
      return { messages: windowed.map((r) => this.toServed(r)), retainedContext: retainedForWindow(windowed) }
    }
    if (!on) return serve(effective)
    if (!compressionModel) return serve(effective)

    // `contextWindow` is optional on `Model` (custom / v1-imported / CherryAI
    // rows can omit it). Without one there is no budget to compact against —
    // and an `as number` cast here made every derived budget `NaN`, which
    // silently disabled compaction instead of triggering it. Serve as-is; the
    // persist lane still bounds tool outputs by the character setting.
    const minContextWindow = resolveMinContextWindow(models.map((m) => m.contextWindow))
    if (minContextWindow === null) {
      logger.warn('no model declares a contextWindow — skipping durable compaction for this request', { topicId })
      return serve(effective)
    }
    // Against the room the PROMPT actually has: whatever this request declares
    // as max_tokens is billed alongside the input, so it is not history's to use.
    const inputRoom = resolveInputRoom(minContextWindow, resolveOutputReservation(assistantId, models))
    // Selects the media cost tables only; text stays on tokenx, matching the
    // in-loop hook so the two triggers cannot disagree on the same history.
    const dialect = resolveRowDialect(models[0])
    if (this.estimateContext(effective, dialect) <= Math.floor(inputRoom * CONTEXT_COMPACT_TRIGGER_RATIO)) {
      return serve(effective)
    }

    const recent = rows.slice(d + 1) // real rows after the marker (summary row is synthetic)
    const keepIdx = planKeepBoundary(recent, Math.floor(inputRoom * CONTEXT_COMPACT_KEEP_BUDGET_RATIO), dialect)
    // Over-budget-without-compacting edge: when everything in `recent` fits the keep
    // budget yet `effective` still exceeds the trigger (a large prior `oldSummary`),
    // there is no boundary to snap, so we serve the marker-applied history as-is. Not a
    // missed compaction — the in-loop `prepareStep` hook owns this case as the second
    // safety net (see inLoopCompaction; the no-double-compact test pins the interaction).
    if (keepIdx === null) return serve(effective)

    const boundary = recent[keepIdx - 1] // real row before the kept user row

    const oldSummary = d >= 0 ? rows[d].compactionSummary : undefined
    // Declared before the try so the catch can settle the anchor it opened:
    // this summarize call runs BEFORE the model stream, so without an explicit
    // clear a failed fold would leave "compacting…" pinned on a live turn.
    const startedAt = new Date().toISOString()
    const preTokens = this.estimateContext(effective, dialect)
    // One id per fold: a turn can compact several times, and a shared id would
    // make each later fold overwrite the previous one's anchor.
    const anchorId = compactionAnchorChunkId()
    try {
      // Fold = the older slice of `recent` (before the keep boundary). Convert those rows
      // to served UIMessages, then to ModelMessages via the shared pipeline. (messageConverter
      // + its prepareModelMessages were removed in main #16257; toModelMessages is the successor.)
      const realModelMessages = await toModelMessages(recent.slice(0, keepIdx).map((r) => this.toServed(r)))
      const modelMessages: ModelMessage[] = [
        ...(oldSummary
          ? [{ role: 'user' as const, content: ContextPrompts.getCompactSummaryWrapper(oldSummary) }]
          : []),
        ...realModelMessages
      ]
      // Budget the summarize call against the window it is meant to protect:
      // its input carries whole tool outputs, so without a cap the compression
      // request can itself exceed the window (starving the output budget until
      // the model returns no summary at all — the empty-summary path below).
      // The window that matters here is the COMPRESSOR's, not the request
      // model's: an explicitly picked 8k compressor on a 128k chat would
      // otherwise be handed a 128k-derived budget and overflow immediately.
      const compressionWindow = compressionModel.contextWindow ?? minContextWindow
      const maxOutputTokens = resolveCompressionOutputTokens(compressionWindow)
      compactionSink?.(anchorId, { status: 'compacting', phase: 'turn-start', startedAt })
      const summary = await summarizeModelMessages(modelMessages, compressionModel.languageModel, {
        maxOutputTokens,
        maxInputTokens: Math.max(
          COMPACTION_MIN_INPUT_BUDGET,
          Math.floor((compressionWindow - maxOutputTokens) * COMPACTION_INPUT_SAFETY_RATIO)
        ),
        abortSignal: signal
      })
      signal?.throwIfAborted()
      // Every exit below clears the spinner — a fold that produced nothing and a
      // fold that threw both continue with un-compacted history, so leaving
      // "compacting…" on screen would misreport a turn that is really running.
      const settle = (extra?: Partial<CompactionAnchorData>) => {
        const completedAt = new Date().toISOString()
        compactionSink?.(anchorId, {
          status: 'done',
          phase: 'turn-start',
          startedAt,
          completedAt,
          durationMs: Date.parse(completedAt) - Date.parse(startedAt),
          preTokens,
          ...extra
        })
      }
      // A fold that changed nothing (empty summary) or threw is served with UN-compacted
      // history, so it must settle as `skipped` (metric-free) — settling `done` here is exactly
      // what makes an untouched history render a false "context compacted" marker.
      const skip = () =>
        compactionSink?.(anchorId, {
          status: 'skipped',
          phase: 'turn-start',
          startedAt,
          completedAt: new Date().toISOString()
        })
      if (!summary) {
        logger.warn('durable compaction yielded empty summary; serving marker-applied history', { topicId })
        skip()
        return serve(effective)
      }
      signal?.throwIfAborted()
      messageService.setCompactionSummary(boundary.id, summary)
      // Boundary index in rawUI: recent = rows.slice(d + 1), boundary = recent[keepIdx - 1].
      const served = [
        summaryRow(boundary.id, summary, manifestHandles(d + keepIdx), manifestPaths(d + keepIdx)),
        ...recent.slice(keepIdx)
      ]
      settle({ postTokens: this.estimateContext(served, dialect), foldedCount: keepIdx })
      return serve(served)
    } catch (error) {
      if (signal?.aborted) throw error
      logger.warn('durable compaction failed; serving marker-applied history', { topicId, error })
      // Un-compacted history served → settle `skipped`, not `done` (no false marker).
      compactionSink?.(anchorId, {
        status: 'skipped',
        phase: 'turn-start',
        startedAt,
        completedAt: new Date().toISOString()
      })
      return serve(effective)
    }
  }

  private buildStreamRequest(
    topicId: string,
    assistantId: string | undefined,
    uniqueModelId: UniqueModelId,
    history: CherryUIMessage[],
    messageId: string,
    knowledgeBaseIds: string[] | undefined,
    reasoningEffort: AiStreamRequest['reasoningEffort'],
    serviceTier: AiStreamRequest['serviceTier'],
    fastMode: boolean,
    retainedContext?: RetainedContext
  ): AiStreamRequest {
    return {
      chatId: topicId,
      trigger: ConversationOpenTrigger.SubmitMessage,
      assistantId,
      uniqueModelId,
      messages: history,
      messageId,
      knowledgeBaseIds,
      reasoningEffort,
      serviceTier,
      fastMode,
      ...(retainedContext ? { retainedContext } : {})
    }
  }
}

export const persistentChatContextProvider = new PersistentChatContextProvider()
