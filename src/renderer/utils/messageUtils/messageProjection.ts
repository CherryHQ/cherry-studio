import {
  type BranchMessage,
  type CherryMessagePart,
  type CherryUIMessage,
  type Message as SharedMessage,
  toContentRole
} from '@shared/data/types/message'

export function sharedMessageToUIMessage(shared: SharedMessage): CherryUIMessage {
  return {
    id: shared.id,
    role: toContentRole(shared.role),
    parts: (shared.data?.parts ?? []) as CherryUIMessage['parts'],
    metadata: {
      parentId: shared.parentId,
      siblingsGroupId: shared.siblingsGroupId || undefined,
      modelId: shared.modelId ?? undefined,
      modelSnapshot: shared.modelSnapshot ?? undefined,
      status: shared.status,
      createdAt: shared.createdAt,
      stats: shared.stats ?? undefined,
      ...(shared.stats?.totalTokens ? { totalTokens: shared.stats.totalTokens } : {})
    }
  }
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

export function branchMessagesToFullUIMessages(branchItems: BranchMessage[]): CherryUIMessage[] {
  const messages: CherryUIMessage[] = []
  const seen = new Set<string>()

  const pushMessage = (message: SharedMessage) => {
    if (seen.has(message.id)) return
    seen.add(message.id)
    messages.push(sharedMessageToUIMessage(message))
  }

  for (const item of branchItems) {
    if (!item.siblingsGroup?.length) {
      pushMessage(item.message)
      continue
    }

    const group = [item.message, ...item.siblingsGroup].sort((a, b) => {
      const timeCompare = a.createdAt.localeCompare(b.createdAt)
      return timeCompare === 0 ? a.id.localeCompare(b.id) : timeCompare
    })
    group.forEach(pushMessage)
  }

  return messages
}
