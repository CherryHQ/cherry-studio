import { messagePartsAt, type MessagePartRows } from '@renderer/utils/message/messagePartRows'

import { projectCompletedMessageParts } from '../blocks/messagePartLayouts'
import type { MessageListItem } from '../types'

export function getMessageGroupKey(message: MessageListItem): string {
  if (message.historicalProcessGroupId) return `historical-process:${message.historicalProcessGroupId}`
  return message.role === 'assistant' && message.parentId ? `assistant${message.parentId}` : message.role + message.id
}

export function withHistoricalProcessGroups(
  messages: MessageListItem[],
  partsByMessageId: MessagePartRows | null,
  cache: WeakMap<MessageListItem, MessageListItem>
): MessageListItem[] {
  const result = [...messages]
  let groupId: string | undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const parts = messagePartsAt(partsByMessageId, message.id) ?? []
    if (message.role !== 'assistant' || !parts.length) {
      groupId = undefined
      continue
    }
    if (message.isImportedHistory) {
      if (!['success', 'paused', 'error'].includes(message.status)) {
        groupId = undefined
        continue
      }
    } else {
      const hasHistoricalTool = parts.some(
        (part) =>
          part.type === 'dynamic-tool' &&
          part.toolName === 'historical_tool' &&
          (part.state === 'output-available' || part.state === 'output-error')
      )
      if (message.parentId || message.status !== 'success' || !hasHistoricalTool) {
        groupId = undefined
        continue
      }
      const layout = projectCompletedMessageParts(parts.map((part, index) => ({ part, index })))
      if (layout.items.some((item) => item.kind === 'part') || layout.reportEntries.length) {
        groupId = undefined
        continue
      }
    }
    if (Boolean(message.isImportedHistory) !== Boolean(messages[index + 1]?.isImportedHistory)) groupId = undefined
    // Keep the newest member as the anchor when pagination prepends older process records.
    groupId ??= message.id
    let item = cache.get(message)
    if (item?.historicalProcessGroupId !== groupId) {
      item = { ...message, historicalProcessGroupId: groupId }
      cache.set(message, item)
    }
    result[index] = item
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
