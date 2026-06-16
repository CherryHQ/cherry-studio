/**
 * Default provider for SQLite-backed topics. Catch-all in the dispatcher
 * array — keep it last. Reads topic/assistant/model, persists user msg
 * + placeholders, builds history from the tree path, assembles
 * per-execution `PersistenceListener`s.
 */

import { topicService } from '@data/services/TopicService'
import { application } from '@main/core/application'
import { messageService } from '@main/data/services/MessageService'
import { topicNamingService } from '@main/services/TopicNamingService'
import { type Span, SpanStatusCode } from '@opentelemetry/api'
import { applyApprovalDecisions } from '@shared/ai/transport'
import type { Message as SharedMessage } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { applyTurnInputAttributes, startAiChildTurnSpan } from '../../observability'
import { wrapSteerReminder } from '../../steerReminder'
import type { AiStreamRequest } from '../../types/requests'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TraceFlushListener } from '../listeners/TraceFlushListener'
import { MessageServiceBackend } from '../persistence/backends/MessageServiceBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider, DispatchContext, PreparedDispatch } from './ChatContextProvider'
import type { MainContinueConversationRequest, MainDispatchRequest, MainSteerContinuationRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels, resolvePersistentSiblingsGroupId } from './modelResolution'

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
    role: message.role,
    parts: message.data.parts ?? [],
    metadata: {
      parentId: message.parentId,
      siblingsGroupId: message.siblingsGroupId || undefined,
      modelId: message.modelId ?? undefined,
      modelSnapshot: message.modelSnapshot ?? undefined,
      status: message.status,
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
    const topic = await topicService.getById(req.topicId)
    const { assistantId, defaultModelId } = await resolveAssistantModelId(topic?.assistantId)

    // continue-conversation reuses the existing assistant anchor — no new placeholder, no multi-model.
    if (req.trigger === 'continue-conversation') {
      return this.prepareContinueDispatch(subscriber, req, assistantId, defaultModelId)
    }

    // steer-continuation answers a steer user message persisted while a turn was live — a fresh
    // assistant placeholder under that user row (no new user row), single model.
    if (req.trigger === 'steer-continuation') {
      return this.prepareSteerContinuation(subscriber, req, assistantId, defaultModelId)
    }

    if (ctx.hasLiveStream && req.trigger === 'submit-message') {
      // Stamp the row with the model the user selected for this steer so the continuation answers
      // with it — `prepareSteerContinuation` reads `userMessage.modelId`. Steer is single-model: if
      // multiple models were @-mentioned, only the first is used (multi-model steer is unsupported).
      const steerModelId = req.mentionedModelIds?.[0] ?? defaultModelId
      const userMessage = await messageService.create(req.topicId, {
        role: 'user',
        parentId: req.parentAnchorId,
        data: { parts: req.userMessageParts },
        status: 'success',
        modelId: steerModelId,
        modelSnapshot: (() => {
          const { providerId, modelId: rawModelId } = parseUniqueModelId(steerModelId)
          return { id: rawModelId, name: rawModelId, provider: providerId }
        })()
      })

      return {
        topicId: req.topicId,
        models: [],
        listeners: [subscriber],
        userMessageId: userMessage.id,
        pendingSteerUserMessageId: userMessage.id,
        reservedMessages: [toReservedUIMessage(userMessage)],
        isMultiModel: false
      }
    }

    // 3. Models (single or multi)
    const isRegenerate = req.trigger === 'regenerate-message'
    const models = await resolveModels(req.mentionedModelIds, defaultModelId)
    const isMultiModel = models.length > 1

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
    const siblingsGroupId = await resolvePersistentSiblingsGroupId(models, isRegenerate, req.parentAnchorId ?? '')

    // User message + N placeholders in one tx — SQLite rolls back on any failure.
    const userMessageInput =
      req.trigger === 'submit-message'
        ? ({
            mode: 'create' as const,
            dto: {
              role: 'user' as const,
              parentId: req.parentAnchorId,
              data: { parts: req.userMessageParts },
              status: 'success' as const,
              modelId: defaultModelId,
              modelSnapshot: (() => {
                const { providerId, modelId: rawModelId } = parseUniqueModelId(defaultModelId)
                return { id: rawModelId, name: rawModelId, provider: providerId }
              })()
            }
          } as const)
        : ({ mode: 'existing' as const, id: req.parentAnchorId } as const)

    // Container trace: one trace tree per topic. Each model's `ai.turn` span is
    // a child under it. Spans are created before the DB write, so a failure between
    // here and the handoff to `send()` must end them explicitly or they leak.
    const containerTraceId = await topicService.ensureTraceId(req.topicId)
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, models, containerTraceId)
    try {
      const { userMessage, placeholders } = await messageService.createUserMessageWithPlaceholders({
        topicId: req.topicId,
        userMessage: userMessageInput,
        siblingsGroupId,
        placeholders: turnRootSpans.map(({ model }) => ({
          role: 'assistant',
          data: { parts: [] },
          status: 'pending',
          modelId: model.id,
          modelSnapshot: {
            id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
            name: model.name,
            provider: model.providerId
          }
        }))
      })

      const shouldAutoNameInitialTurn = !isRegenerate && !req.parentAnchorId
      if (shouldAutoNameInitialTurn) {
        void topicNamingService.maybeRenameFromFirstUserMessage(req.topicId, userMessage.id)
      }

      const assistantPlaceholders = turnRootSpans.map(({ model, span }, i) => ({
        model,
        placeholder: placeholders[i],
        rootSpan: span
      }))

      // 1 subscriber + N per-model persistence listeners. Auto-rename attaches
      // to the first backend only so it fires once for multi-model turns.
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
              modelSnapshot: {
                id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
                name: model.name,
                provider: model.providerId
              },
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
      const history = await this.buildHistory(userMessage.id)
      const models_ = assistantPlaceholders.map(({ model, placeholder, rootSpan }) => ({
        modelId: model.id,
        request: this.buildStreamRequest(req.topicId, assistantId, model.id, history, placeholder.id),
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
    assistantId: string | undefined,
    defaultModelId: UniqueModelId
  ): Promise<PreparedDispatch> {
    const anchor = await messageService.getById(req.parentAnchorId)
    if (anchor.role !== 'assistant') {
      throw new Error(`'continue-conversation' anchor must be an assistant message (got '${anchor.role}')`)
    }
    if (anchor.topicId !== req.topicId) {
      throw new Error(`'continue-conversation' anchor does not belong to topic ${req.topicId}`)
    }

    // Apply decisions to DB parts and flip status to `pending` so buildHistory sees the approved state.
    const beforeParts = anchor.data.parts ?? []
    const updatedParts = applyApprovalDecisions(beforeParts, req.approvalDecisions)
    // Continue uses the original assistant's model — switching mid-approval invalidates approval semantics.
    // `anchor.modelId` is nullable; coalesce null/undefined away first, then a single boundary cast.
    const continueModelId = (anchor.modelId ?? defaultModelId) as UniqueModelId
    const [model] = await resolveModels([continueModelId], defaultModelId)

    // `ai.turn` span under the topic's container trace; end it explicitly if
    // anything below throws or it leaks.
    const containerTraceId = await topicService.ensureTraceId(req.topicId)
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, [model], containerTraceId)
    const [{ span: rootSpan }] = turnRootSpans
    try {
      await messageService.update(req.parentAnchorId, {
        data: { parts: updatedParts },
        status: 'pending'
      })

      const listeners: StreamListener[] = [
        subscriber,
        new PersistenceListener({
          topicId: req.topicId,
          modelId: model.id,
          backend: new MessageServiceBackend({
            assistantMessageId: anchor.id,
            modelSnapshot: anchor.modelSnapshot ?? {
              id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
              name: model.name,
              provider: model.providerId
            }
          }),
          onPersistFailed: (error) =>
            application.get('AiStreamManager').broadcastTopicError(req.topicId, model.id, error)
        }),
        new TraceFlushListener(req.topicId)
      ]

      const history = await this.buildHistory(anchor.id)
      return {
        topicId: req.topicId,
        models: [
          {
            modelId: model.id,
            request: this.buildStreamRequest(req.topicId, assistantId, model.id, history, anchor.id),
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
    assistantId: string | undefined,
    defaultModelId: UniqueModelId
  ): Promise<PreparedDispatch> {
    const userMessage = await messageService.getById(req.userMessageId)
    if (userMessage.role !== 'user') {
      throw new Error(`'steer-continuation' anchor must be a user message (got '${userMessage.role}')`)
    }
    if (userMessage.topicId !== req.topicId) {
      throw new Error(`'steer-continuation' anchor does not belong to topic ${req.topicId}`)
    }

    const steerModelId = (userMessage.modelId ?? defaultModelId) as UniqueModelId
    const [model] = await resolveModels([steerModelId], defaultModelId)
    const modelSnapshot = {
      id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
      name: model.name,
      provider: model.providerId
    }

    const containerTraceId = await topicService.ensureTraceId(req.topicId)
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, [model], containerTraceId)
    const [{ span: rootSpan }] = turnRootSpans
    try {
      const { placeholders } = await messageService.createUserMessageWithPlaceholders({
        topicId: req.topicId,
        userMessage: { mode: 'existing', id: req.userMessageId },
        placeholders: [{ role: 'assistant', data: { parts: [] }, status: 'pending', modelId: model.id, modelSnapshot }]
      })
      const placeholder = placeholders[0]

      const listeners: StreamListener[] = [
        subscriber,
        new PersistenceListener({
          topicId: req.topicId,
          modelId: model.id,
          backend: new MessageServiceBackend({ assistantMessageId: placeholder.id, modelSnapshot }),
          onPersistFailed: (error) =>
            application.get('AiStreamManager').broadcastTopicError(req.topicId, model.id, error)
        }),
        new TraceFlushListener(req.topicId)
      ]

      const history = withSteerReminder(await this.buildHistory(req.userMessageId))
      return {
        topicId: req.topicId,
        models: [
          {
            modelId: model.id,
            request: this.buildStreamRequest(req.topicId, assistantId, model.id, history, placeholder.id),
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

  /**
   * Path from root → anchor. Anchor: user msg for submit/regenerate, or
   * assistant msg for continue-conversation (so the model sees the
   * approval-responded state).
   */
  private async buildHistory(anchorMessageId: string): Promise<CherryUIMessage[]> {
    const messagePath = await messageService.getPathToNode(anchorMessageId)
    return messagePath.map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: msg.data.parts ?? []
    }))
  }

  private buildStreamRequest(
    topicId: string,
    assistantId: string | undefined,
    uniqueModelId: UniqueModelId,
    history: CherryUIMessage[],
    messageId: string
  ): AiStreamRequest {
    return {
      chatId: topicId,
      trigger: 'submit-message',
      assistantId,
      uniqueModelId,
      messages: history,
      messageId
    }
  }
}

export const persistentChatContextProvider = new PersistentChatContextProvider()
