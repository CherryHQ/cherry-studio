import type { MessageExportView } from '@renderer/types/messageExport'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'

import type { MessageListItem } from '../types'
import { createMessageExportView } from './messageListItem'

export function getOrderedSelectedMessageIds(
  messageIds: readonly string[],
  orderedMessages: readonly Pick<MessageListItem, 'id'>[]
): string[] {
  if (orderedMessages.length === 0) return [...messageIds]

  const selected = new Set(messageIds)
  const orderedIds = orderedMessages.filter((message) => selected.has(message.id)).map((message) => message.id)
  const orderedIdSet = new Set(orderedIds)

  return [...orderedIds, ...messageIds.filter((messageId) => !orderedIdSet.has(messageId))]
}

export function createSelectedMessageExportViews(
  messageIds: readonly string[],
  orderedMessages: readonly MessageListItem[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): MessageExportView[] {
  const messageById = new Map(orderedMessages.map((message) => [message.id, message]))

  return getOrderedSelectedMessageIds(messageIds, orderedMessages)
    .map((messageId) => {
      const message = messageById.get(messageId)
      if (!message) return null
      return createMessageExportView(message, partsByMessageId[messageId] ?? [])
    })
    .filter((message): message is MessageExportView => message !== null)
}

export function getSelectedMessagesPlainText(
  messageIds: readonly string[],
  orderedMessages: readonly MessageListItem[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): string {
  return getOrderedSelectedMessageIds(messageIds, orderedMessages)
    .map((messageId) => getTextFromParts(partsByMessageId[messageId] ?? []))
    .filter(Boolean)
    .join('\n\n---\n\n')
}
