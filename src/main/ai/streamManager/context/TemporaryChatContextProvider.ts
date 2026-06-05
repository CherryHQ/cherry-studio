/**
 * In-memory temporary topics — append-only, no tree, no siblings.
 * Routing is state-based (`hasTopic`): after `persist()`, the topic
 * moves out of the in-memory map and the persistent provider takes over.
 */

import { loggerService } from '@logger'
import { isAgentSessionTopic } from '@main/ai/agentSession/topic'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import type { AiStreamRequest } from '../../types/requests'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TemporaryChatBackend } from '../persistence/backends/TemporaryChatBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import type { ChatContextProvider, PreparedDispatch } from './ChatContextProvider'
import type { MainDispatchRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels } from './modelResolution'

const logger = loggerService.withContext('TemporaryChatContextProvider')

export class TemporaryChatContextProvider implements ChatContextProvider {
  readonly name = 'temporary'

  canHandle(topicId: string): boolean {
    // Defensive — agent-session prefix is never temporary regardless of `hasTopic`.
    if (isAgentSessionTopic(topicId)) return false
    return temporaryChatService.hasTopic(topicId)
  }

  async prepareDispatch(subscriber: StreamListener, req: MainDispatchRequest): Promise<PreparedDispatch> {
    if (req.trigger === 'regenerate-message') {
      throw new Error('regenerate-message is not supported for temporary chats (immutable append-only)')
    }
    if (req.trigger === 'continue-conversation') {
      throw new Error('continue-conversation is not supported for temporary chats (immutable append-only)')
    }

    const topic = temporaryChatService.getTopic(req.topicId)
    if (!topic) throw new Error(`Temporary topic not found: ${req.topicId}`)

    const { assistantId, defaultModelId } = await resolveAssistantModelId(topic.assistantId)

    let resolveWith: UniqueModelId[] | undefined
    if (req.mentionedModelIds?.length) {
      if (req.mentionedModelIds.length > 1) {
        logger.warn('Temporary chat received multiple mentionedModelIds — only the first is used', {
          topicId: req.topicId,
          mentioned: req.mentionedModelIds
        })
      }
      resolveWith = [req.mentionedModelIds[0]]
    }
    const models = await resolveModels(resolveWith, defaultModelId)
    const model = models[0]
    const { modelId: rawModelId, providerId } = parseUniqueModelId(model.id)
    const modelSnapshot = {
      id: model.apiModelId ?? rawModelId,
      name: model.name,
      provider: providerId
    }

    // Append user first so `history` (listMessages) includes it. Service generates the id.
    await temporaryChatService.appendMessage(req.topicId, {
      role: 'user',
      data: { parts: req.userMessageParts },
      status: 'success',
      modelId: model.id,
      modelSnapshot
    })

    const prior = await temporaryChatService.listMessages(req.topicId)
    const history: CherryUIMessage[] = prior.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.data.parts ?? []
    }))

    const listeners: StreamListener[] = [
      subscriber,
      new PersistenceListener({
        topicId: req.topicId,
        modelId: model.id,
        backend: new TemporaryChatBackend({ topicId: req.topicId, modelId: model.id, modelSnapshot }),
        onPersistFailed: (error) =>
          void subscriber.onError({ error, status: 'error', modelId: model.id, isTopicDone: true })
      })
    ]

    // No pre-allocated `messageId`: AI SDK generates one for the UI; the service generates its own on append.
    const streamRequest: AiStreamRequest = {
      chatId: req.topicId,
      trigger: 'submit-message',
      assistantId,
      uniqueModelId: model.id,
      messages: history
    }

    return {
      topicId: req.topicId,
      models: [{ modelId: model.id, request: streamRequest }],
      listeners,
      isMultiModel: false
    }
  }
}

export const temporaryChatContextProvider = new TemporaryChatContextProvider()
