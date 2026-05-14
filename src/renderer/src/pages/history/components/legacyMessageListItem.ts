import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { modelToSnapshot } from '@renderer/components/chat/messages/utils/messageListItem'
import type { Message } from '@renderer/types/newMessage'
import type { MessageStats } from '@shared/data/types/message'

export function legacyMessageToListItem(message: Message): MessageListItem {
  return {
    id: message.id,
    role: message.role,
    assistantId: message.assistantId,
    topicId: message.topicId,
    parentId: message.askId ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    status: normalizeLegacyStatus(message.status),
    modelId: message.modelId,
    modelSnapshot: modelToSnapshot(message.model),
    siblingsGroupId: message.siblingsGroupId,
    stats: legacyMessageStats(message),
    traceId: message.traceId,
    mentions: message.mentions?.map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      ...(model.group && { group: model.group })
    })),
    type: message.type
  }
}

function normalizeLegacyStatus(status: Message['status']): MessageListItem['status'] {
  const normalized = String(status ?? '').toLowerCase()
  if (normalized === 'pending' || normalized === 'processing' || normalized === 'searching') return 'pending'
  if (normalized === 'error') return 'error'
  if (normalized === 'paused') return 'paused'
  return 'success'
}

function legacyMessageStats(message: Message): MessageStats | undefined {
  const completionTokens = message.usage?.completion_tokens ?? message.metrics?.completion_tokens
  const stats: MessageStats = {
    ...(message.usage?.prompt_tokens !== undefined && { promptTokens: message.usage.prompt_tokens }),
    ...(completionTokens !== undefined && { completionTokens }),
    ...(message.usage?.total_tokens !== undefined && { totalTokens: message.usage.total_tokens }),
    ...(message.usage?.thoughts_tokens !== undefined && { thoughtsTokens: message.usage.thoughts_tokens }),
    ...(message.usage?.cost !== undefined && { cost: message.usage.cost }),
    ...(message.metrics?.time_first_token_millsec !== undefined && {
      timeFirstTokenMs: message.metrics.time_first_token_millsec
    }),
    ...(message.metrics?.time_completion_millsec !== undefined && {
      timeCompletionMs: message.metrics.time_completion_millsec
    }),
    ...(message.metrics?.time_thinking_millsec !== undefined && {
      timeThinkingMs: message.metrics.time_thinking_millsec
    })
  }

  return Object.keys(stats).length > 0 ? stats : undefined
}
