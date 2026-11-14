import type { MessageListItem } from '../types'

export function getMessageGroupKey(message: MessageListItem): string {
  return message.role === 'assistant' && message.parentId ? `assistant${message.parentId}` : message.role + message.id
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
