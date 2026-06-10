import type { Model } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import {
  createUniqueModelId,
  isUniqueModelId,
  type Model as SharedModel,
  parseUniqueModelId
} from '@shared/data/types/model'
import { isToolUIPart } from 'ai'

import type { MessageListItem } from '../types'

export interface MessageListItemContext {
  assistantId?: string
  topicId: string
  modelFallback?: ModelSnapshot
}

export function modelToSnapshot(model: Model | SharedModel | undefined): ModelSnapshot | undefined {
  if (!model) return undefined
  if ('providerId' in model) {
    const { providerId, modelId } = isUniqueModelId(model.id)
      ? parseUniqueModelId(model.id)
      : { providerId: model.providerId, modelId: model.id }
    return {
      id: model.apiModelId ?? modelId,
      name: model.name,
      provider: providerId,
      ...(model.group && { group: model.group })
    }
  }

  const { providerId, modelId } = isUniqueModelId(model.id)
    ? parseUniqueModelId(model.id)
    : { providerId: model.provider, modelId: model.id }
  return {
    id: modelId,
    name: model.name,
    provider: providerId,
    ...(model.group && { group: model.group })
  }
}

function statsFromMetadata(metadata: CherryUIMessage['metadata']): MessageStats | undefined {
  if (!metadata) return undefined
  const stats: MessageStats = { ...metadata.stats }
  if (metadata.totalTokens !== undefined) stats.totalTokens = metadata.totalTokens
  if (metadata.promptTokens !== undefined) stats.promptTokens = metadata.promptTokens
  if (metadata.completionTokens !== undefined) stats.completionTokens = metadata.completionTokens
  if (metadata.thoughtsTokens !== undefined) stats.thoughtsTokens = metadata.thoughtsTokens
  return Object.keys(stats).length > 0 ? stats : undefined
}

export function toMessageListItem(message: CherryUIMessage, ctx: MessageListItemContext): MessageListItem {
  const metadata = message.metadata ?? {}
  const modelSnapshot = metadata.modelSnapshot ?? (message.role === 'assistant' ? ctx.modelFallback : undefined)
  const modelId =
    metadata.modelId ??
    (message.role === 'assistant' && modelSnapshot
      ? createUniqueModelId(modelSnapshot.provider, modelSnapshot.id)
      : undefined)

  return {
    id: message.id,
    role: message.role,
    assistantId: ctx.assistantId,
    topicId: ctx.topicId,
    parentId: metadata.parentId ?? null,
    createdAt: metadata.createdAt ?? '',
    status: message.role === 'assistant' ? (metadata.status ?? 'pending') : 'success',
    modelId,
    modelSnapshot,
    siblingsGroupId: metadata.siblingsGroupId,
    isActiveBranch: metadata.isActiveBranch,
    stats: statsFromMetadata(message.metadata)
  }
}

export function getMessageListItemModel(message: MessageListItem): Model | undefined {
  if (message.modelSnapshot) {
    return {
      id: message.modelSnapshot.id,
      name: message.modelSnapshot.name,
      provider: message.modelSnapshot.provider,
      group: message.modelSnapshot.group ?? ''
    }
  }

  if (!message.modelId || !isUniqueModelId(message.modelId)) return undefined

  const { providerId, modelId } = parseUniqueModelId(message.modelId)
  return {
    id: modelId,
    name: modelId,
    provider: providerId,
    group: ''
  }
}

export function getMessageListItemModelName(message: MessageListItem): string {
  const model = getMessageListItemModel(message)
  return model?.name || model?.id || message.modelId || ''
}

export function isMessageListItemProcessing(message: Pick<MessageListItem, 'status'>): boolean {
  return message.status === 'pending'
}

export function isMessageListItemAwaitingApproval(message: MessageListItem, parts: CherryMessagePart[]): boolean {
  if (message.status !== 'paused') return false
  return parts.some((part) => isToolUIPart(part) && part.state === 'approval-requested')
}
