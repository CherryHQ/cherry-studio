import type { MessageListItem } from '../types'

export function getMessageGroupKey(message: MessageListItem): string {
  return message.role === 'assistant' && message.parentId ? `assistant${message.parentId}` : message.role + message.id
}

/** Resolve assistant messages to the user turn that owns them. */
export function getOwningUserMessageIdByAssistantId(messages: readonly MessageListItem[]): Map<string, string> {
  const userMessageIds = new Set(messages.filter((message) => message.role === 'user').map((message) => message.id))
  const result = new Map<string, string>()
  let precedingUserMessageId: string | undefined

  for (const message of messages) {
    if (message.role === 'user') {
      precedingUserMessageId = message.id
      continue
    }
    if (message.role !== 'assistant') continue

    const ownerId =
      message.parentId != null
        ? userMessageIds.has(message.parentId)
          ? message.parentId
          : undefined
        : precedingUserMessageId
    if (ownerId) result.set(message.id, ownerId)
  }

  return result
}

export function groupMessageListItems(messages: MessageListItem[]): Record<string, MessageListItem[]> {
  const grouped: Record<string, MessageListItem[]> = {}

  for (const message of messages) {
    const key = getMessageGroupKey(message)
    grouped[key] ??= []
    grouped[key].push(message)
  }

  return grouped
}

export function getLatestAssistantGroupKey(messages: MessageListItem[]): string | undefined {
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')

  return latestAssistantMessage ? getMessageGroupKey(latestAssistantMessage) : undefined
}
