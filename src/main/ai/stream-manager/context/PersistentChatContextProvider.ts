/**
 * PersistentChatContextProvider — the default provider for regular (SQLite-backed) topics.
 *
 * Responsibilities for a single `Ai_Stream_Open` request:
 *  - read the topic + assistant + model from SQLite
 *  - persist the user message (or resolve it when regenerating)
 *  - create one `pending` assistant placeholder per execution
 *  - build the conversation history from the tree path
 *  - assemble per-execution PersistenceListeners
 *  - dispatch N executions against AiStreamManager
 *
 * This provider intentionally handles "any topicId that isn't claimed by another provider".
 * Keep it last in the dispatcher providers array (see `./dispatch.ts`).
 */

import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { messageService } from '@main/data/services/MessageService'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { AiStreamRequest } from '../../AiCompletionService'
import type { AiStreamManager } from '../AiStreamManager'
import { PersistenceListener } from '../listeners/PersistenceListener'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider } from './ChatContextProvider'
import { resolveModels, resolvePersistentSiblingsGroupId } from './modelResolution'

export class PersistentChatContextProvider implements ChatContextProvider {
  readonly name = 'persistent'

  /** Default provider — matches any topic not claimed by a more specific provider. */
  canHandle(): boolean {
    return true
  }

  async handle(
    manager: AiStreamManager,
    subscriber: StreamListener,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    // 1. Resolve context
    const topic = await topicService.getById(req.topicId)
    const assistantId = topic?.assistantId
    if (!assistantId) throw new Error(`Cannot resolve assistantId for topic ${req.topicId}`)

    const assistant = await assistantDataService.getById(assistantId)
    if (!assistant.modelId) throw new Error(`Assistant ${assistantId} has no model configured`)

    const defaultModelId = assistant.modelId

    // 2. User message
    const isRegenerate = req.trigger === 'regenerate-message'
    const userMessage = isRegenerate
      ? await messageService.getById(req.parentAnchorId ?? '')
      : await messageService.create(req.topicId, {
          role: 'user',
          parentId: req.parentAnchorId,
          data: { parts: req.userMessageParts },
          status: 'success',
          modelId: defaultModelId,
          modelSnapshot: (() => {
            const { providerId, modelId: rawModelId } = parseUniqueModelId(defaultModelId)
            return { id: rawModelId, name: rawModelId, provider: providerId }
          })()
        })

    const shouldAutoNameInitialTurn = !isRegenerate && !req.parentAnchorId
    if (shouldAutoNameInitialTurn) {
      void topicNamingService.maybeRenameFromFirstUserMessage(req.topicId, userMessage.id)
    }

    // 3. Models (single or multi)
    const models = await resolveModels(req.mentionedModelIds, defaultModelId)
    const isMultiModel = models.length > 1

    // 4. Siblings group
    const siblingsGroupId = await resolvePersistentSiblingsGroupId(models, isRegenerate, userMessage.id)

    // 5. Create one assistant placeholder per execution before streaming starts.
    const assistantPlaceholders = await Promise.all(
      models.map(async (model) => {
        const placeholder = await messageService.create(req.topicId, {
          role: 'assistant',
          parentId: userMessage.id,
          data: { parts: [] },
          status: 'pending',
          modelId: model.id,
          modelSnapshot: {
            id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
            name: model.name,
            provider: model.providerId
          },
          siblingsGroupId
        })

        return { model, placeholder }
      })
    )

    // 6. Build listeners: 1 subscriber + N persistence listeners
    const listeners: StreamListener[] = [subscriber]
    for (const { model, placeholder } of assistantPlaceholders) {
      listeners.push(
        new PersistenceListener({
          topicId: req.topicId,
          assistantMessageId: placeholder.id,
          parentUserMessageId: userMessage.id,
          modelId: model.id,
          modelSnapshot: {
            id: model.apiModelId ?? parseUniqueModelId(model.id).modelId,
            name: model.name,
            provider: model.providerId
          },
          siblingsGroupId,
          afterPersist: shouldAutoNameInitialTurn
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
      )
    }

    // 7. Build requests + dispatch
    const history = await this.buildHistory(userMessage.id)
    const requests = assistantPlaceholders.map(({ model, placeholder }) => ({
      model,
      request: this.buildStreamRequest(req.topicId, assistantId, model.id, history, placeholder.id)
    }))

    manager.startExecution({
      topicId: req.topicId,
      modelId: requests[0].model.id,
      request: requests[0].request,
      listeners,
      siblingsGroupId,
      isMultiModel
    })

    for (let i = 1; i < requests.length; i++) {
      manager.startExecution({
        topicId: req.topicId,
        modelId: requests[i].model.id,
        request: requests[i].request,
        listeners: [],
        siblingsGroupId,
        isMultiModel
      })
    }

    return {
      mode: 'started',
      executionIds: isMultiModel ? models.map((m: Model) => m.id) : undefined
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
      role: msg.role as CherryUIMessage['role'],
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
