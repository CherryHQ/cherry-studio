/**
 * Default provider for SQLite-backed topics. Catch-all in the dispatcher
 * array — keep it last. Reads topic/assistant/model, persists user msg
 * + placeholders, builds history from the tree path, assembles
 * per-execution `PersistenceListener`s.
 */

import { topicService } from '@data/services/TopicService'
import { messageService } from '@main/data/services/MessageService'
import { topicNamingService } from '@main/services/TopicNamingService'
import { type Span, SpanStatusCode } from '@opentelemetry/api'
import { applyApprovalDecisions } from '@shared/ai/transport'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { startAiTurnTrace } from '../../observability'
import type { AiStreamRequest } from '../../types/requests'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TraceFlushListener } from '../listeners/TraceFlushListener'
import { MessageServiceBackend } from '../persistence/backends/MessageServiceBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider, PreparedDispatch } from './ChatContextProvider'
import type { MainContinueConversationRequest, MainDispatchRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels, resolvePersistentSiblingsGroupId } from './modelResolution'

/**
 * One OTel root span per execution. Stream-manager sets the span active
 * around `runExecutionLoop` so AI SDK spans become children.
 */
function startTurnRootSpans(topicId: string, trigger: string, models: Model[]): Array<{ model: Model; span: Span }> {
  return models.map((model) => {
    const modelName = model.name ?? model.id
    const turnTrace = startAiTurnTrace(
      'chat.turn',
      {
        attributes: {
          'cs.topic_id': topicId,
          'cs.trigger': trigger,
          'cs.model_id': model.id,
          'cs.role': 'assistant'
        }
      },
      { topicId, modelName }
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

export class PersistentChatContextProvider implements ChatContextProvider {
  readonly name = 'persistent'

  /** Default provider — matches any topic not claimed by a more specific provider. */
  canHandle(): boolean {
    return true
  }

  async prepareDispatch(subscriber: StreamListener, req: MainDispatchRequest): Promise<PreparedDispatch> {
    // 1. Resolve context
    const topic = await topicService.getById(req.topicId)
    const { assistantId, defaultModelId } = await resolveAssistantModelId(topic?.assistantId)

    // continue-conversation reuses the existing assistant anchor — no new placeholder, no multi-model.
    if (req.trigger === 'continue-conversation') {
      return this.prepareContinueDispatch(subscriber, req, assistantId, defaultModelId)
    }

    // 3. Models (single or multi)
    const isRegenerate = req.trigger === 'regenerate-message'
    const models = await resolveModels(req.mentionedModelIds, defaultModelId)
    const isMultiModel = models.length > 1

    if (isRegenerate && !req.parentAnchorId) {
      throw new Error(`'regenerate-message' requires parentAnchorId`)
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

    // Spans are created before the DB write so a failure between here and the
    // handoff to `send()` must end them explicitly or they leak.
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, models)
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
              void subscriber.onError({ error, status: 'error', modelId: model.id, isTopicDone: true })
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

      return {
        topicId: req.topicId,
        models: models_,
        listeners,
        userMessageId: userMessage.id,
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

    // Created before the DB write; end it explicitly if anything below throws
    // or it leaks.
    const turnRootSpans = startTurnRootSpans(req.topicId, req.trigger, [model])
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
            void subscriber.onError({ error, status: 'error', modelId: model.id, isTopicDone: true })
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
