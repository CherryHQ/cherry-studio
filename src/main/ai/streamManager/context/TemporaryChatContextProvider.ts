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
import {
  ConversationActiveNodeMove,
  ConversationKind,
  ConversationOpenTrigger,
  ConversationOutcomeKind,
  type ConversationRef
} from '@shared/ai/conversation'
import { toContentRole } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import { getKnowledgeBaseIdsFromParts } from '@shared/data/types/uiParts'
import { v7 as uuidv7 } from 'uuid'

import type { AiStreamRequest } from '../../types'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { TemporaryChatBackend } from '../persistence/backends/TemporaryChatBackend'
import type { CherryUIMessage } from '../types'
import {
  type CommittedConversationIntent,
  type ConversationCrashRecoveryResult,
  type ConversationExecutionContext,
  ConversationExecutionDriverBindingKind,
  type ConversationExecutionPreparationDescriptor,
  ConversationExecutionPreparationKind,
  ConversationHistoryAdapterKind,
  type ConversationHistoryPort,
  type ConversationIntentValidationContext,
  type ConversationTerminalPersistenceDescriptor,
  ConversationTerminalPersistenceKind,
  type ConversationTerminalWrite,
  type ValidatedConversationIntent
} from './ConversationHistoryPort'
import type { MainDispatchRequest } from './dispatch'
import { resolveAssistantModelId, resolveModels } from './modelResolution'

const logger = loggerService.withContext('TemporaryChatContextProvider')

export class TemporaryChatContextProvider implements ConversationHistoryPort {
  readonly name = 'temporary'
  readonly isPersistentConversation = false

  recoverCrashOrphans(): ConversationCrashRecoveryResult {
    return { repairedOutputs: [] }
  }

  canHandle(conversation: ConversationRef): boolean {
    return conversation.kind === ConversationKind.Chat && temporaryChatService.hasTopic(conversation.id)
  }

  async validateIntent(
    req: MainDispatchRequest,
    ctx: ConversationIntentValidationContext,
    signal: AbortSignal
  ): Promise<ValidatedConversationIntent> {
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

  commitIntent(
    validation: ValidatedConversationIntent,
    context: ConversationIntentValidationContext
  ): CommittedConversationIntent {
    if (validation.kind !== ConversationHistoryAdapterKind.TemporaryChat) {
      throw new Error(`Temporary Chat received ${validation.kind} validation`)
    }
    const req = validation.request
    const ctx = context
    if (req.trigger !== ConversationOpenTrigger.SubmitMessage) {
      throw new Error(`${req.trigger} is not supported for temporary chats (immutable append-only)`)
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
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.TemporaryChat,
      conversation: req.conversation,
      modelId: model.id,
      outputNodeId: messageId,
      assistantId,
      messages: history,
      knowledgeBaseIds: getKnowledgeBaseIdsFromParts(req.userMessageParts),
      reasoningEffort: req.reasoningEffort,
      serviceTier: req.serviceTier,
      fastMode: req.fastMode === true
    }
    return {
      conversation: req.conversation,
      input: { historyNodeId: skeleton.user.id },
      executions: [
        {
          modelId: model.id,
          outputNodeId: messageId,
          preparation,
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.TemporaryChat,
            topicId: req.conversation.id,
            messageId,
            modelId: model.id,
            messageSnapshot
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Chat }
        }
      ],
      reservedMessages,
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: []
    }
  }

  async prepareExecutionContext(
    descriptor: ConversationExecutionPreparationDescriptor,
    signal: AbortSignal
  ): Promise<ConversationExecutionContext> {
    if (descriptor.kind !== ConversationExecutionPreparationKind.TemporaryChat) {
      throw new Error(`Temporary Chat cannot prepare ${descriptor.kind}`)
    }
    signal.throwIfAborted()
    const request: AiStreamRequest = {
      chatId: descriptor.conversation.id,
      trigger: ConversationOpenTrigger.SubmitMessage,
      assistantId: descriptor.assistantId,
      uniqueModelId: descriptor.modelId,
      messageId: descriptor.outputNodeId,
      messages: [...descriptor.messages],
      knowledgeBaseIds: descriptor.knowledgeBaseIds ? [...descriptor.knowledgeBaseIds] : undefined,
      reasoningEffort: descriptor.reasoningEffort,
      serviceTier: descriptor.serviceTier,
      ...(descriptor.fastMode ? { fastMode: true } : {})
    }
    return {
      conversation: descriptor.conversation,
      models: [{ modelId: descriptor.modelId, request }]
    }
  }

  async persistTerminal(
    descriptor: ConversationTerminalPersistenceDescriptor,
    terminal: ConversationTerminalWrite
  ): Promise<void> {
    if (descriptor.kind !== ConversationTerminalPersistenceKind.TemporaryChat) {
      throw new Error(`Temporary Chat cannot persist ${descriptor.kind}`)
    }
    const port = new PersistenceListener({
      topicId: descriptor.topicId,
      modelId: descriptor.modelId,
      backend: new TemporaryChatBackend({
        topicId: descriptor.topicId,
        messageId: descriptor.messageId,
        modelId: descriptor.modelId,
        messageSnapshot: descriptor.messageSnapshot
      })
    })
    if (terminal.status === ConversationOutcomeKind.Success) await port.onDone(terminal)
    else if (terminal.status === ConversationOutcomeKind.Paused) await port.onPaused(terminal)
    else await port.onError(terminal)
  }
}

export const temporaryChatContextProvider = new TemporaryChatContextProvider()
