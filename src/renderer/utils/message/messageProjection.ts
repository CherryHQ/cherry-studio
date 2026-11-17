import {
  type CherryMessagePart,
  type CherryUIMessage,
  type Message as SharedMessage,
  toContentRole
} from '@shared/data/types/message'
import { isBlankUserTurn } from '@shared/data/types/uiParts'

export function sharedMessageToUIMessage(shared: SharedMessage): CherryUIMessage {
  return {
    id: shared.id,
    role: toContentRole(shared.role),
    parts: shared.data?.parts ?? [],
    metadata: {
      parentId: shared.parentId,
      siblingsGroupId: shared.siblingsGroupId || undefined,
      modelId: shared.modelId ?? undefined,
      modelSelection: shared.data.modelSelection,
      messageSnapshot: shared.messageSnapshot ?? undefined,
      status: shared.status,
      turnOptions: shared.data.turnOptions,
      createdAt: shared.createdAt,
      stats: shared.stats ?? undefined,
      ...(shared.stats?.totalTokens ? { totalTokens: shared.stats.totalTokens } : {})
    }
  }
}

export function isRenderableConversationMessage(message: CherryUIMessage): boolean {
  return !isBlankUserTurn({ role: message.role, status: message.metadata?.status, parts: message.parts })
}

export function uiMessagesToPartsMap(messages: CherryUIMessage[]): Record<string, CherryMessagePart[]> {
  const map: Record<string, CherryMessagePart[]> = {}
  for (const message of messages) {
    if (message.parts.length > 0) {
      map[message.id] = message.parts
    }
  }
  return map
}
