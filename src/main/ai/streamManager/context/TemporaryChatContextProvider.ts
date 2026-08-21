/**
 * In-memory temporary topics — append-only, no tree, no siblings.
 * Routing is state-based (`hasTopic`): after `persist()`, the topic
 * moves out of the in-memory map and the persistent provider takes over.
 */

import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { resolveContextSettings } from '@main/ai/contextBuild/resolveContextSettings'
import { resolveGlobalContextSettings } from '@main/ai/contextBuild/resolveRequestContextSettings'
import { applyMaxMessagesWindow } from '@main/ai/messages/maxMessagesWindow'
import { temporaryChatService } from '@main/data/services/TemporaryChatService'
import { ConversationKind, ConversationOpenTrigger, type ConversationRef } from '@shared/ai/conversation'
import { toContentRole } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import { getKnowledgeBaseIdsFromParts } from '@shared/data/types/uiParts'
import { v7 as uuidv7 } from 'uuid'

import type { AiStreamRequest } from '../../types'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TemporaryChatBackend } from '../persistence/backends/TemporaryChatBackend'
import type { CherryUIMessage, StreamListener } from '../types'
import {
  type CommittedDispatch,
  type ConversationExecutionContext,
  ConversationHistoryAdapterKind,
  type ConversationHistoryPort,
  type DispatchContext,
  type ValidatedDispatch
} from './ConversationHistoryPort'
import type { MainDispatchRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels } from './modelResolution'

const logger = loggerService.withContext('TemporaryChatContextProvider')

export class TemporaryChatContextProvider implements ConversationHistoryPort {
  readonly name = 'temporary'
  readonly isPersistentConversation = false

  canHandle(conversation: ConversationRef): boolean {
    return conversation.kind === ConversationKind.Chat && temporaryChatService.hasTopic(conversation.id)
  }

  async validateDispatch(
    req: MainDispatchRequest,
    ctx: DispatchContext,
    signal: AbortSignal
  ): Promise<ValidatedDispatch> {
    signal.throwIfAborted()
    if (req.trigger !== ConversationOpenTrigger.SubmitMessage) {
      throw new Error(`${req.trigger} is not supported for temporary chats`)
    }
    const topic = temporaryChatService.getTopic(req.conversation.id)
    if (!topic) throw new Error(`Temporary topic not found: ${req.conversation.id}`)
    const selectedModelId = req.mentionedModelIds?.[0]
    const { assistantId, defaultModelId } =
      !topic.assistantId && selectedModelId
        ? { assistantId: undefined, defaultModelId: selectedModelId }
        : resolveAssistantModelId(topic.assistantId)
    const resolvedModels = resolveModels(selectedModelId ? [selectedModelId] : undefined, defaultModelId)
    return {
      kind: ConversationHistoryAdapterKind.TemporaryChat,
      request: req,
      context: ctx,
      executionModelIds: resolvedModels.map((model) => model.id),
      resolvedModels,
      assistantId
    }
  }

  commitDispatch(
    subscriber: StreamListener,
    validation: ValidatedDispatch,
    context: DispatchContext
  ): CommittedDispatch {
    if (validation.kind !== ConversationHistoryAdapterKind.TemporaryChat) {
      throw new Error(`Temporary Chat received ${validation.kind} validation`)
    }
    const req = validation.request
    const ctx = context
    if (req.trigger === 'regenerate-message') {
      throw new Error('regenerate-message is not supported for temporary chats (immutable append-only)')
    }
    if (req.trigger === 'continue-conversation') {
      throw new Error('continue-conversation is not supported for temporary chats (immutable append-only)')
    }
    if (req.trigger === 'steer-continuation') {
      // Never reached: steers are only enqueued for persistent topics (provider-gated in dispatch).
      throw new Error('steer-continuation is not supported for temporary chats')
    }
    // Temporary chats have no steer queue, so a busy submit can't be absorbed. Refuse it here rather
    // than letting `send()` take the inject branch and silently discard the models (the message would
    // be persisted to the in-memory history, acked as success, and never answered). The renderer
    // disables input while busy; main holds its own line. Mirrors the trigger guards above.
    if (ctx.hasLiveStream) {
      throw new Error('Cannot submit to a temporary chat while a turn is in flight')
    }

    const assistantId = validation.assistantId
    if (req.mentionedModelIds?.length) {
      if (req.mentionedModelIds.length > 1) {
        logger.warn('Temporary chat received multiple mentionedModelIds — only the first is used', {
          topicId: req.conversation.id,
          mentioned: req.mentionedModelIds
        })
      }
    }
    const models = validation.resolvedModels
    const model = models[0]
    const { modelId: rawModelId, providerId } = parseUniqueModelId(model.id)
    const modelSnap = { id: model.apiModelId ?? rawModelId, name: model.name, provider: providerId }
    // The assistant owns the model — snapshot it (model nested) onto the assistant reply.
    const assistant = assistantId ? assistantDataService.getById(assistantId) : undefined
    const messageSnapshot = assistant
      ? { id: assistant.id, name: assistant.name, emoji: assistant.emoji, model: modelSnap }
      : undefined

    const prior = temporaryChatService.listMessages(req.conversation.id)
    // Same scope rule as the persistent provider, and likewise independent of
    // the `enabled` kill-switch, which owns the overflow policy instead.
    const contextSettings = resolveContextSettings({
      globals: resolveGlobalContextSettings(),
      assistant: assistant?.settings?.contextSettings
    })
    const messageId = uuidv7()
    const skeleton = temporaryChatService.commitTurnSkeleton(req.conversation.id, {
      user: {
        role: 'user',
        data: { parts: req.userMessageParts },
        status: 'success',
        modelId: model.id
      },
      assistant: {
        id: messageId,
        role: 'assistant',
        data: { parts: [] },
        modelId: model.id,
        messageSnapshot
      }
    })
    const fullHistory: CherryUIMessage[] = [...prior, skeleton.user].map((message) => ({
      id: message.id,
      role: toContentRole(message.role),
      parts: message.data.parts ?? []
    }))
    const history = applyMaxMessagesWindow(fullHistory, contextSettings.maxMessages)
    const listeners: StreamListener[] = [subscriber]
    const persistencePorts = [
      new PersistenceListener({
        topicId: req.conversation.id,
        modelId: model.id,
        backend: new TemporaryChatBackend({
          topicId: req.conversation.id,
          messageId,
          modelId: model.id,
          messageSnapshot
        })
      })
    ]

    const reservedMessages: CherryUIMessage[] = [skeleton.user, skeleton.assistant].map((message) => ({
      id: message.id,
      role: toContentRole(message.role),
      parts: message.data.parts ?? [],
      metadata: {
        status: message.status,
        createdAt: message.createdAt,
        modelId: message.modelId ?? undefined,
        messageSnapshot: message.messageSnapshot ?? undefined
      }
    }))
    return {
      reservation: {
        conversation: req.conversation,
        models: [{ modelId: model.id, outputNodeId: messageId }],
        listeners,
        persistencePorts,
        cleanupPorts: [],
        reservedMessages
      },
      prepareExecutionContext: async (signal) => {
        signal.throwIfAborted()
        const streamRequest: AiStreamRequest = {
          chatId: req.conversation.id,
          trigger: 'submit-message',
          assistantId,
          uniqueModelId: model.id,
          messageId,
          messages: history,
          knowledgeBaseIds: getKnowledgeBaseIdsFromParts(req.userMessageParts),
          reasoningEffort: req.trigger === 'submit-message' ? req.reasoningEffort : undefined,
          ...(req.trigger === 'submit-message' && req.fastMode ? { fastMode: true } : {})
        }
        return {
          conversation: req.conversation,
          models: [{ modelId: model.id, request: streamRequest }]
        } satisfies ConversationExecutionContext
      }
    }
  }
}

export const temporaryChatContextProvider = new TemporaryChatContextProvider()
