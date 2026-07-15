import type { MessageExportView } from '@renderer/types/messageExport'
import type { Model } from '@renderer/types/model'
import { resolveUniqueModelId } from '@renderer/utils/message/modelIdentity'
import type { CherryMessagePart, CherryUIMessage, MessageStats } from '@shared/data/types/message'
import {
  createUniqueModelId,
  isUniqueModelId,
  type Model as SharedModel,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import { isToolUIPart } from 'ai'

import type { MessageListItem } from '../types'

export interface MessageListItemContext {
  assistantId?: string
  topicId: string
}

function statsFromMetadata(metadata: CherryUIMessage['metadata']): MessageStats | undefined {
  if (!metadata) return undefined
  const stats: MessageStats = { ...metadata.stats }
  if (metadata.totalTokens !== undefined) stats.totalTokens = metadata.totalTokens
  return Object.keys(stats).length > 0 ? stats : undefined
}

export function toMessageListItem(message: CherryUIMessage, ctx: MessageListItemContext): MessageListItem {
  const metadata = message.metadata ?? {}
  const messageSnapshot = metadata.messageSnapshot
  // The snapshot IS the producing author (model nested). Model priority: the frozen author's model →
  // the row's own frozen `modelId`. Both are captured at send time, so switching the live model or
  // assistant never moves a past message's header.
  const author = messageSnapshot
  let model = author?.model
  if (!model && metadata.modelId && isUniqueModelId(metadata.modelId)) {
    const { providerId, modelId } = parseUniqueModelId(metadata.modelId)
    model = { id: modelId, name: modelId, provider: providerId }
  }
  const modelId =
    metadata.modelId ??
    (message.role === 'assistant' && model ? createUniqueModelId(model.provider, model.id) : undefined)

  return {
    id: message.id,
    role: message.role,
    assistantId: ctx.assistantId,
    topicId: ctx.topicId,
    parentId: metadata.parentId ?? null,
    createdAt: metadata.createdAt ?? '',
    status: message.role === 'assistant' ? (metadata.status ?? 'pending') : 'success',
    modelId,
    model,
    messageSnapshot,
    siblingsGroupId: metadata.siblingsGroupId,
    isActiveBranch: metadata.isActiveBranch,
    stats: statsFromMetadata(message.metadata)
  }
}

export function getMessageListItemModel(message: MessageListItem): Model | undefined {
  if (message.model) {
    return {
      id: message.model.id,
      name: message.model.name,
      provider: message.model.provider,
      group: message.model.group ?? ''
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

export function getDirectAssistantModelsByUserId(messages: MessageListItem[]): Map<string, SharedModel[]> {
  const modelsByUserId = new Map<string, SharedModel[]>()
  const seenModelIdsByUserId = new Map<string, Set<UniqueModelId>>()

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.parentId) continue

    const model = getMessageListItemModel(message)
    const uniqueModelId = model
      ? resolveUniqueModelId(message.modelId, { provider: model.provider, id: model.id })
      : undefined
    if (!model || !uniqueModelId) continue

    let seenModelIds = seenModelIdsByUserId.get(message.parentId)
    if (!seenModelIds) {
      seenModelIds = new Set()
      seenModelIdsByUserId.set(message.parentId, seenModelIds)
    }
    if (seenModelIds.has(uniqueModelId)) continue

    seenModelIds.add(uniqueModelId)
    const userModels = modelsByUserId.get(message.parentId) ?? []
    userModels.push({
      id: uniqueModelId,
      providerId: model.provider,
      apiModelId: model.id,
      name: model.name,
      group: model.group || undefined,
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
    modelsByUserId.set(message.parentId, userModels)
  }

  return modelsByUserId
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

export function createMessageExportView(message: MessageListItem, parts: CherryMessagePart[]): MessageExportView {
  const model = getMessageListItemModel(message)
  return {
    id: message.id,
    role: message.role,
    assistantId: message.assistantId,
    topicId: message.topicId,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    status: message.status,
    modelId: message.modelId,
    model,
    messageSnapshot: message.messageSnapshot,
    parentId: message.parentId,
    siblingsGroupId: message.siblingsGroupId,
    stats: message.stats,
    parts
  }
}
