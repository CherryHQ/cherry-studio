import {
  type BranchMessage,
  type CherryMessagePart,
  type CherryUIMessage,
  type Message as SharedMessage,
  sharedMessageToUIMessage
} from '@shared/data/types/message'

export { sharedMessageToUIMessage } from '@shared/data/types/message'

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
