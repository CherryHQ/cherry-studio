/**
 * Default provider for SQLite-backed topics. Catch-all in the dispatcher
 * array — keep it last. Reads topic/assistant/model, persists user msg
 * + placeholders, builds history from the tree path, assembles
 * per-execution `PersistenceListener`s.
 */

import { application } from '@application'
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
import { collectRetainedContext, type RetainedContext } from '@main/ai/messages/retainedContext'
import { messageService } from '@main/data/services/MessageService'
import { topicNamingService } from '@main/services/TopicNamingService'
import { type Span, SpanStatusCode } from '@opentelemetry/api'
import { compactionAnchorChunkId, type CompactionAnchorData, type CompactionSink } from '@shared/ai/compaction'
import { applyApprovalDecisions } from '@shared/ai/transport'
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
import type { ModelMessage, UIMessage, UIMessageChunk } from 'ai'

import { resolveMinContextWindow } from '../../contextBuild/resolveContextWindow'
import { resolveRequestContextSettings } from '../../contextBuild/resolveRequestContextSettings'
import { toModelMessages } from '../../messages/messageRules'
import { applyTurnInputAttributes, startAiChildTurnSpan } from '../../observability'
import { wrapSteerReminder } from '../../steerReminder'
import type { AiStreamRequest } from '../../types'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TraceFlushListener } from '../listeners/TraceFlushListener'
import { MessageServiceBackend } from '../persistence/backends/MessageServiceBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider, DispatchContext, PreparedDispatch } from './ChatContextProvider'
import {
  applyDeepestMarker,
  type CompactionRow,
  estimateRowTokens,
  findDeepestMarker,
  planKeepBoundary,
  summaryRow
} from './compaction'
import type { MainContinueConversationRequest, MainDispatchRequest, MainSteerContinuationRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels, resolvePersistentSiblingsGroupId } from './modelResolution'

const logger = loggerService.withContext('PersistentChatContextProvider')

/**
 * Adapt a turn subscriber into a {@link CompactionSink}.
 *
 * Turn-start compaction is a full summarize round-trip that runs BEFORE the
 * model stream opens, so without this the UI sits on an idle placeholder for
 * however long the summarizer takes. The subscriber is already live here (it is
 * `prepareDispatch`'s first argument), so the anchor part can stream ahead of
 * the assistant's own content. Both writes share one id, so the `done` event
 * replaces the spinner rather than appending a second anchor.
 */
function toCompactionSink(subscriber: StreamListener): CompactionSink {
  return (anchorId, data) =>
    subscriber.onChunk({ type: 'data-compaction-anchor', id: anchorId, data } as UIMessageChunk)
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
 * One OTel root span per execution. Stream-manager sets the span active
 * around `runExecutionLoop` so AI SDK spans become children.
 */
function startTurnRootSpans(
  topicId: string,
  trigger: string,
  models: Model[],
  containerTraceId: string
): Array<{ model: Model; span: Span }> {
  return models.map((model) => {
    const modelName = model.name ?? model.id
    const turnTrace = startAiChildTurnSpan(
      'ai.turn',
      {
        attributes: {
          'cs.topic_id': topicId,
          'cs.trigger': trigger,
          'cs.model_id': model.id,
          'cs.role': 'assistant'
        }
      },
      { topicId, modelName },
      containerTraceId
    )
    return { model, span: turnTrace.rootSpan }
  })
}

/**
 * End freshly-created turn root spans with an error status. Used to release
 * spans that would otherwise leak when `prepareDispatch` throws after span
 * creation but before the spans are handed off to the stream executions
 * (which take over ending them). Each `end()` is isolated so one failure
 * can't strand the rest.
 */
function endTurnRootSpansWithError(spans: Array<{ span: Span }>, error: unknown): void {
  const message = error instanceof Error ? error.message : 'prepareDispatch failed before stream launch'
  for (const { span } of spans) {
    try {
      span.setStatus({ code: SpanStatusCode.ERROR, message })
      span.end()
    } catch {
      // Best-effort cleanup — a broken span must not mask the original error.
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

export class PersistentChatContextProvider implements ChatContextProvider {
  readonly name = 'persistent'

  /** Default provider — matches any topic not claimed by a more specific provider. */
  canHandle(): boolean {
    return true
  }

  async prepareDispatch(
    subscriber: StreamListener,
    req: MainDispatchRequest,
    ctx: DispatchContext
  ): Promise<PreparedDispatch> {
    // 1. Resolve context
    const topic = topicService.getById(req.topicId)

    // continue-conversation reuses the existing assistant anchor — no new placeholder, no multi-model.
    if (req.trigger === 'continue-conversation') {
      return this.prepareContinueDispatch(subscriber, req, topic?.assistantId ?? undefined)
    }

    // steer-continuation answers a steer user message persisted while a turn was live — a fresh
    // assistant placeholder under that user row (no new user row), single model.
    if (req.trigger === 'steer-continuation') {
      return this.prepareSteerContinuation(subscriber, req, topic?.assistantId ?? undefined)
    }

    const selectedModelId = req.mentionedModelIds?.[0]
    const { assistantId, defaultModelId } =
      !topic?.assistantId && selectedModelId
        ? { assistantId: undefined, defaultModelId: selectedModelId }
        : resolveAssistantModelId(topic?.assistantId)
    const hasExplicitReservedTarget = req.trigger === 'submit-message' && req.targetMode === 'reserved-branch'
    const reservedBranchId =
      req.trigger === 'submit-message' &&
      req.parentAnchorId &&
      (hasExplicitReservedTarget ||
        (req.targetMode === undefined && messageService.isAwaitingInputLeaf(req.parentAnchorId, req.topicId)))
        ? req.parentAnchorId
        : undefined

    if (hasExplicitReservedTarget && !reservedBranchId) {
      throw new Error("'reserved-branch' target requires parentAnchorId")
    }

    if (ctx.hasLiveStream && req.trigger === 'submit-message') {
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
      const userMessage = messageService.create(req.topicId, {
        role: 'user',
        parentId: req.parentAnchorId,
        data: { parts: req.userMessageParts },
        status: 'success',
        // User rows carry only `modelId` (read by steer-continuation); the author snapshot
        // lives on the assistant reply, which is what the header renders.
        modelId: steerModelId
      })

      return {
        topicId: req.topicId,
        models: [],
        listeners: [subscriber],
        userMessageId: userMessage.id,
        pendingSteerUserMessageId: userMessage.id,
        pendingSteerReasoningEffort: req.reasoningEffort,
        pendingSteerFastMode: req.fastMode === true,
        reservedMessages: [toReservedUIMessage(userMessage)],
        isMultiModel: false
      }
    }

    // 3. Models (single or multi)
    const isRegenerate = req.trigger === 'regenerate-message'
    const models = resolveModels(req.mentionedModelIds, defaultModelId)
    const isMultiModel = models.length > 1
    const turnOptions: AssistantTurnOptions = {
      reasoningEffort: req.reasoningEffort,
      fastMode: req.fastMode === true
    }

    if (isRegenerate && !req.parentAnchorId) {
      throw new Error(`'regenerate-message' requires parentAnchorId`)
    }

    // A regenerate while the topic is still live would build placeholder rows that send()'s inject
    // path discards — orphaning them as `pending`. The renderer gates regenerate on a non-busy topic,
    // so reject this should-not-happen state before any DB write instead of failing silently.
    if (isRegenerate && ctx.hasLiveStream) {
      throw new Error('Cannot regenerate while a stream is live on this topic')
    }

    // Pure compute; backfill happens inside the reservation tx. Resolver short-circuits
    // for non-regenerate, so passing undefined parentAnchorId is harmless.
    const siblingsGroupId = resolvePersistentSiblingsGroupId(models, isRegenerate, req.parentAnchorId ?? '')
    const assistantIdentity = resolveAssistantIdentity(assistantId)

    // User message + N placeholders in one tx — SQLite rolls back on any failure.
    const userMessageInput =
      req.trigger === 'submit-message'
        ? reservedBranchId
          ? ({
              mode: 'fill-reserved' as const,
              id: reservedBranchId,
              data: { parts: req.userMessageParts },
              modelId: defaultModelId
            } as const)
          : ({
              mode: 'create' as const,
              dto: {
                role: 'user' as const,
                parentId: req.parentAnchorId,
                data: { parts: req.userMessageParts },
                status: 'success' as const,
                modelId: defaultModelId
              }
            } as const)
        : ({ mode: 'existing' as const, id: req.parentAnchorId } as const)

    // Container trace: one trace tree per topic. Each model's `ai.turn` span is
    // a child under it. Spans are created before the DB write, so a failure between
    // here and the handoff to `send()` must end them explicitly or they leak.
    const containerTraceId = topicService.ensureTraceId(req.topicId)
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, models, containerTraceId)
    try {
      const { userMessage, placeholders } = messageService.createUserMessageWithPlaceholders({
        topicId: req.topicId,
        userMessage: userMessageInput,
        siblingsGroupId,
        placeholders: turnRootSpans.map(({ model }) => ({
          role: 'assistant',
          data: { parts: [], turnOptions },
          status: 'pending',
          modelId: model.id,
          messageSnapshot: buildAssistantMessageSnapshot(model, assistantIdentity)
        }))
      })

      const shouldAutoNameInitialTurn = !isRegenerate && !req.parentAnchorId
      if (shouldAutoNameInitialTurn) {
        topicNamingService.maybeRenameFromFirstUserMessage(req.topicId, userMessage.id)
      }

      const assistantPlaceholders = turnRootSpans.map(({ model, span }, i) => ({
        model,
        placeholder: placeholders[i],
        rootSpan: span
      }))

      // 1 subscriber + N per-model persistence listeners. Auto-rename attaches
      // to the first backend only so it fires once for multi-model turns.
      const contextSettingsOverride = resolveAssistantContextOverride(assistantId)
      const listeners: StreamListener[] = [subscriber]
      for (let i = 0; i < assistantPlaceholders.length; i++) {
        const { model, placeholder } = assistantPlaceholders[i]
        const attachAutoRename = shouldAutoNameInitialTurn && i === 0
        listeners.push(
          new PersistenceListener({
            topicId: req.topicId,
            modelId: model.id,
            backend: new MessageServiceBackend({
              assistantMessageId: placeholder.id,
              turnOptions,
              contextSettingsOverride,
              afterPersist: attachAutoRename
                ? async (finalMessage) => {
                    await topicNamingService.maybeRenameFromConversationSummary(
                      req.topicId,
                      assistantId,
                      userMessage.id,
                      finalMessage
                    )
                  }
                : undefined
            }),
            onPersistFailed: (error) =>
              application.get('AiStreamManager').broadcastTopicError(req.topicId, model.id, error)
          })
        )
      }
      listeners.push(new TraceFlushListener(req.topicId))

      // 7. Build per-model requests. The dispatcher runs `manager.send` itself.
      const { messages: history, retainedContext } = await this.resolveCompactedHistory(
        userMessage.id,
        req.topicId,
        assistantPlaceholders.map((p) => p.model),
        contextSettingsOverride,
        toCompactionSink(subscriber)
      )
      const knowledgeBaseIds = getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? [])
      const models_ = assistantPlaceholders.map(({ model, placeholder, rootSpan }) => ({
        modelId: model.id,
        request: this.buildStreamRequest(
          req.topicId,
          assistantId,
          model.id,
          history,
          placeholder.id,
          knowledgeBaseIds,
          turnOptions.reasoningEffort,
          turnOptions.fastMode === true,
          retainedContext
        ),
        rootSpan
      }))
      // Author the turn span's input attributes here, where the built request payload is available.
      for (const { modelId, request, rootSpan } of models_) {
        if (rootSpan) {
          applyTurnInputAttributes(rootSpan, {
            modelId,
            topicId: req.topicId,
            operation: 'chat',
            messages: request.messages
          })
        }
      }
      return {
        topicId: req.topicId,
        models: models_,
        listeners,
        userMessageId: userMessage.id,
        reservedMessages: [userMessage, ...placeholders].map(toReservedUIMessage),
        siblingsGroupId,
        isMultiModel
      }
    } catch (error) {
      endTurnRootSpansWithError(turnRootSpans, error)
      throw error
    }
  }

  /**
   * Resume an assistant turn paused on tool-approval. Reuses the existing
   * row (no new placeholder, no sibling group). Renderer sends decisions
   * only; Main applies them to DB-authoritative parts. Backend's
   * `assistantMessageId === anchor.id` makes the terminal write an update.
   */
  private async prepareContinueDispatch(
    subscriber: StreamListener,
    req: MainContinueConversationRequest,
    assistantId: string | undefined
  ): Promise<PreparedDispatch> {
    const anchor = messageService.getById(req.parentAnchorId)
    if (anchor.role !== 'assistant') {
      throw new Error(`'continue-conversation' anchor must be an assistant message (got '${anchor.role}')`)
    }
    if (anchor.topicId !== req.topicId) {
      throw new Error(`'continue-conversation' anchor does not belong to topic ${req.topicId}`)
    }
    const knowledgeBaseIds = anchor.parentId
      ? getKnowledgeBaseIdsFromParts(messageService.getById(anchor.parentId).data.parts ?? [])
      : undefined

    // Apply decisions to DB parts and flip status to `pending` so resolveCompactedHistory sees the approved state.
    const beforeParts = anchor.data.parts ?? []
    const updatedParts = applyApprovalDecisions(beforeParts, req.approvalDecisions)
    // Continue uses the original assistant's model — switching mid-approval invalidates approval semantics.
    // `anchor.modelId` is nullable; coalesce null/undefined away first, then a single boundary cast.
    const continueModelId = (anchor.modelId ?? resolveAssistantModelId(assistantId).defaultModelId) as UniqueModelId
    const [model] = resolveModels([continueModelId], continueModelId)

    // `ai.turn` span under the topic's container trace; end it explicitly if
    // anything below throws or it leaks.
    const containerTraceId = topicService.ensureTraceId(req.topicId)
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, [model], containerTraceId)
    const [{ span: rootSpan }] = turnRootSpans
    try {
      messageService.update(req.parentAnchorId, {
        data: { ...anchor.data, parts: updatedParts },
        status: 'pending'
      })

      const contextSettingsOverride = resolveAssistantContextOverride(assistantId)
      const listeners: StreamListener[] = [
        subscriber,
        new PersistenceListener({
          topicId: req.topicId,
          modelId: model.id,
          backend: new MessageServiceBackend({
            assistantMessageId: anchor.id,
            turnOptions: anchor.data.turnOptions,
            contextSettingsOverride
          }),
          onPersistFailed: (error) =>
            application.get('AiStreamManager').broadcastTopicError(req.topicId, model.id, error)
        }),
        new TraceFlushListener(req.topicId)
      ]

      const { messages: history, retainedContext } = await this.resolveCompactedHistory(
        anchor.id,
        req.topicId,
        [model],
        contextSettingsOverride,
        toCompactionSink(subscriber)
      )
      return {
        topicId: req.topicId,
        models: [
          {
            modelId: model.id,
            runtimeTimingSeed: anchor.stats?.runtimeTiming,
            request: this.buildStreamRequest(
              req.topicId,
              assistantId,
              model.id,
              history,
              anchor.id,
              knowledgeBaseIds,
              anchor.data.turnOptions?.reasoningEffort,
              anchor.data.turnOptions?.fastMode === true,
              retainedContext
            ),
            rootSpan
          }
        ],
        listeners,
        siblingsGroupId: undefined,
        isMultiModel: false
      }
    } catch (error) {
      endTurnRootSpansWithError(turnRootSpans, error)
      throw error
    }
  }

  /**
   * Answer a steer message persisted while a turn was live (`AiStreamManager.startNextChatTurn`).
   * Creates a fresh assistant placeholder under the steer user row (no new user row) and wraps that
   * trailing user message with a steer system-reminder in the model-facing history only.
   */
  private async prepareSteerContinuation(
    subscriber: StreamListener,
    req: MainSteerContinuationRequest,
    assistantId: string | undefined
  ): Promise<PreparedDispatch> {
    const userMessage = messageService.getById(req.userMessageId)
    if (userMessage.role !== 'user') {
      throw new Error(`'steer-continuation' anchor must be a user message (got '${userMessage.role}')`)
    }
    if (userMessage.topicId !== req.topicId) {
      throw new Error(`'steer-continuation' anchor does not belong to topic ${req.topicId}`)
    }

    const steerModelId = (userMessage.modelId ?? resolveAssistantModelId(assistantId).defaultModelId) as UniqueModelId
    const [model] = resolveModels([steerModelId], steerModelId)
    const messageSnapshot = buildAssistantMessageSnapshot(model, resolveAssistantIdentity(assistantId))
    const turnOptions: AssistantTurnOptions = {
      reasoningEffort: req.reasoningEffort,
      fastMode: req.fastMode
    }

    const containerTraceId = topicService.ensureTraceId(req.topicId)
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, [model], containerTraceId)
    const [{ span: rootSpan }] = turnRootSpans
    try {
      const { placeholders } = messageService.createUserMessageWithPlaceholders({
        topicId: req.topicId,
        userMessage: { mode: 'existing', id: req.userMessageId },
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
      const placeholder = placeholders[0]

      const contextSettingsOverride = resolveAssistantContextOverride(assistantId)
      const listeners: StreamListener[] = [
        subscriber,
        new PersistenceListener({
          topicId: req.topicId,
          modelId: model.id,
          backend: new MessageServiceBackend({
            assistantMessageId: placeholder.id,
            turnOptions,
            contextSettingsOverride
          }),
          onPersistFailed: (error) =>
            application.get('AiStreamManager').broadcastTopicError(req.topicId, model.id, error)
        }),
        new TraceFlushListener(req.topicId)
      ]

      const { messages: compactedHistory, retainedContext } = await this.resolveCompactedHistory(
        req.userMessageId,
        req.topicId,
        [model],
        contextSettingsOverride,
        toCompactionSink(subscriber)
      )
      const history = withSteerReminder(compactedHistory)
      return {
        topicId: req.topicId,
        models: [
          {
            modelId: model.id,
            request: this.buildStreamRequest(
              req.topicId,
              assistantId,
              model.id,
              history,
              placeholder.id,
              getKnowledgeBaseIdsFromParts(userMessage.data.parts ?? []),
              req.reasoningEffort,
              req.fastMode,
              retainedContext
            ),
            rootSpan
          }
        ],
        listeners,
        reservedMessages: [toReservedUIMessage(placeholder)],
        isMultiModel: false
      }
    } catch (error) {
      endTurnRootSpansWithError(turnRootSpans, error)
      throw error
    }
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

  private estimateTotal(rows: CompactionRow[]): number {
    return rows.reduce((s, r) => s + estimateRowTokens(r), 0)
  }

  /**
   * Trigger estimate for the served history. Anchors on the most recent assistant
   * row in the served view that carries a real contextTokens (prior turn's last-step
   * totalTokens), adding a tokenx estimate of only the rows after it. Falls back to a
   * full tokenx estimate when no anchor exists or it was folded out by the marker.
   */
  private estimateContext(effective: CompactionRow[]): number {
    let anchorIdx = -1
    for (let i = effective.length - 1; i >= 0; i--) {
      if (effective[i].role === 'assistant' && typeof effective[i].contextTokens === 'number') {
        anchorIdx = i
        break
      }
    }
    if (anchorIdx < 0) return this.estimateTotal(effective)
    const base = effective[anchorIdx].contextTokens as number
    const tail = effective.slice(anchorIdx + 1).reduce((s, r) => s + estimateRowTokens(r), 0)
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
    anchorMessageId: string,
    topicId: string,
    models: Model[],
    assistantContextOverride?: ContextSettingsOverride | null,
    /** Reports the turn-start fold to the UI; absent when there is no subscriber. */
    compactionSink?: CompactionSink
  ): Promise<{ messages: CherryUIMessage[]; retainedContext: RetainedContext }> {
    // Raw path from root → anchor, preserving all Message fields (including compactionSummary).
    // getPathToNode is synchronous (better-sqlite3, main #16626) — no await.
    const messagePath = messageService.getPathToNode(anchorMessageId)
    const lastClearIndex = messagePath.findLastIndex((message) => hasClearContextPart(message.data.parts))
    const rawMsgs = messagePath.slice(lastClearIndex + 1)
    // Capability state from the RAW path: compaction folds file parts and tool
    // outputs out of the served view, so scanning served messages downstream
    // would silently drop read_file for folded attachments (finding #2) and
    // fs_read for folded persisted outputs. `rawUI` is mapped ONCE and sliced
    // for the manifest prefixes below — handle dedup is a left-to-right fold,
    // so a slice's handles match the full pass only when both share this array.
    const rawUI = rawMsgs.map((m) => ({ parts: m.data.parts ?? [] }) as UIMessage)
    const retainedContext = collectRetainedContext(rawUI)
    const rows = rawMsgs.map((m) => this.toRow(m))
    // Manifest handles cover ONLY the rows folded behind the boundary: live
    // attachments still ride served messages as file parts, and scoping the
    // manifest to the folded prefix makes the summary-row bytes a pure
    // function of the boundary — attaching a file later never rewrites them
    // (provider prefix caches hold).
    const d = findDeepestMarker(rows)
    const manifestHandles = (endIdx: number) => collectFileAttachments(rawUI.slice(0, endIdx + 1)).map((a) => a.handle)
    const effective = applyDeepestMarker(rows, d >= 0 ? manifestHandles(d) : undefined)

    const { contextSettings, compressionModel } = await resolveRequestContextSettings(
      models[0],
      assistantContextOverride
    )
    const on = contextSettings.enabled && contextSettings.compress.enabled && Boolean(compressionModel)
    const serve = (rows_: typeof effective) => ({ messages: rows_.map((r) => this.toServed(r)), retainedContext })
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
    if (this.estimateContext(effective) <= Math.floor(minContextWindow * CONTEXT_COMPACT_TRIGGER_RATIO)) {
      return serve(effective)
    }

    const recent = rows.slice(d + 1) // real rows after the marker (summary row is synthetic)
    const keepIdx = planKeepBoundary(recent, Math.floor(minContextWindow * CONTEXT_COMPACT_KEEP_BUDGET_RATIO))
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
    const preTokens = this.estimateContext(effective)
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
        )
      })
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
      messageService.setCompactionSummary(boundary.id, summary)
      // Boundary index in rawUI: recent = rows.slice(d + 1), boundary = recent[keepIdx - 1].
      const served = [summaryRow(boundary.id, summary, manifestHandles(d + keepIdx)), ...recent.slice(keepIdx)]
      settle({ postTokens: this.estimateContext(served), foldedCount: keepIdx })
      return serve(served)
    } catch (error) {
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
    fastMode: boolean,
    retainedContext?: RetainedContext
  ): AiStreamRequest {
    return {
      chatId: topicId,
      trigger: 'submit-message',
      assistantId,
      uniqueModelId,
      messages: history,
      messageId,
      knowledgeBaseIds,
      reasoningEffort,
      fastMode,
      ...(retainedContext ? { retainedContext } : {})
    }
  }
}

export const persistentChatContextProvider = new PersistentChatContextProvider()
