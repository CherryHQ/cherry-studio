/**
 * PersistentChatContextProvider — the default provider for regular (SQLite-backed) topics.
 *
 * Responsibilities for a single `Ai_Stream_Open` request:
 *  - read the topic + assistant + model from SQLite
 *  - persist the user message (or resolve it when regenerating)
 *  - create one `pending` assistant placeholder per execution
 *  - build the conversation history from the tree path
 *  - assemble per-execution PersistenceListeners
 *
 * This provider intentionally handles "any topicId that isn't claimed by another provider".
 * Keep it last in the dispatcher providers array (see `./dispatch.ts`).
 */

import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { messageService } from '@main/data/services/MessageService'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { AiStreamRequest } from '../../AiService'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { MessageServiceBackend } from '../persistence/backends/MessageServiceBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider, PreparedDispatch } from './ChatContextProvider'
import { resolveModels, resolvePersistentSiblingsGroupId } from './modelResolution'

export class PersistentChatContextProvider implements ChatContextProvider {
  readonly name = 'persistent'

  /** Default provider — matches any topic not claimed by a more specific provider. */
  canHandle(): boolean {
    return true
  }

  async prepareDispatch(subscriber: StreamListener, req: AiStreamOpenRequest): Promise<PreparedDispatch> {
    // 1. Resolve context
    const topic = await topicService.getById(req.topicId)
    const assistantId = topic?.assistantId
    if (!assistantId) throw new Error(`Cannot resolve assistantId for topic ${req.topicId}`)

    const assistant = await assistantDataService.getById(assistantId)
    if (!assistant.modelId) throw new Error(`Assistant ${assistantId} has no model configured`)

    const defaultModelId = assistant.modelId

    // 2. Models (single or multi)
    const isRegenerate = req.trigger === 'regenerate-message'
    const models = await resolveModels(req.mentionedModelIds, defaultModelId)
    const isMultiModel = models.length > 1

    // 3. Siblings group (pure compute — backfill happens inside the reservation tx).
    //    For non-regenerate this reads no children (resolver short-circuits on
    //    models.length > 1 or single-model fresh turn), so passing parentAnchorId
    //    even when undefined is harmless.
    const siblingsGroupId = await resolvePersistentSiblingsGroupId(models, isRegenerate, req.parentAnchorId ?? '')

    // 4. Atomically reserve user message + N placeholders in one transaction.
    //    On any failure SQLite rolls back everything — no compensation logic
    //    needed. Main owns all message ids; the renderer reconciles by
    //    replacing `useChat.state.messages` with the DB snapshot on
    //    stream-done (see `useChatWithHistory.refreshAndReplace`).
    const { userMessage, placeholders } = await messageService.reserveAssistantTurn({
      topicId: req.topicId,
      userMessage: isRegenerate
        ? { mode: 'existing', id: req.parentAnchorId ?? '' }
        : {
            mode: 'create',
            dto: {
              role: 'user',
              parentId: req.parentAnchorId,
              data: { parts: req.userMessageParts },
              status: 'success',
              modelId: defaultModelId,
              modelSnapshot: (() => {
                const { providerId, modelId: rawModelId } = parseUniqueModelId(defaultModelId)
                return { id: rawModelId, name: rawModelId, provider: providerId }
              })()
            }
          },
      siblingsGroupId,
      placeholders: models.map((model) => ({
        role: 'assistant',
        data: { parts: [] },
        status: 'pending',
        modelId: model.id,
        modelSnapshot: {
          id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
          name: model.name,
          provider: model.providerId
        },
        // TODO: replace with traceId from request after v2 refactor
        traceId: crypto.randomUUID()
      }))
    })

    const shouldAutoNameInitialTurn = !isRegenerate && !req.parentAnchorId
    if (shouldAutoNameInitialTurn) {
      void topicNamingService.maybeRenameFromFirstUserMessage(req.topicId, userMessage.id)
    }

    const assistantPlaceholders = models.map((model, i) => ({ model, placeholder: placeholders[i] }))

    // 5. Build listeners: 1 subscriber + N persistence listeners (one per model).
    //    Each listener wraps a MessageServiceBackend that finalizes a single
    //    placeholder. Auto-rename (the only afterPersist hook today) is attached
    //    to *one* backend so it fires exactly once even in multi-model turns.
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
          })
        })
      )
    }

    // 6. Build per-model requests. The dispatcher runs `manager.send` itself.
    const history = await this.buildHistory(userMessage.id)
    const models_ = assistantPlaceholders.map(({ model, placeholder }) => ({
      modelId: model.id,
      request: this.buildStreamRequest(req.topicId, assistantId, model.id, history, placeholder.id)
    }))

    return {
      topicId: req.topicId,
      models: models_,
      listeners,
      siblingsGroupId,
      isMultiModel
    }
  }

  /**
   * Read conversation history along the active path from root → user message.
   * Pulled out of AiStreamManager so the registry stays free of data-layer dependencies.
   */
  private async buildHistory(userMessageId: string): Promise<CherryUIMessage[]> {
    const messagePath = await messageService.getPathToNode(userMessageId)
    return messagePath.map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: msg.data.parts ?? []
    }))
  }

  private buildStreamRequest(
    topicId: string,
    assistantId: string,
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
