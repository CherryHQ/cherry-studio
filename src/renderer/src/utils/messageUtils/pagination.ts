import type { Message } from '@renderer/types/newMessage'

export interface MessagePage {
  messages: Message[]
  nextCursor: number
  hasMore: boolean
}

/**
 * Returns a reverse-chronological page and the exact raw-message cursor it consumed.
 * The page limit counts distinct user messages and assistant reply groups, matching
 * the existing message-list pagination behavior.
 */
export function paginateMessages(messages: Message[], cursor: number, groupLimit: number): MessagePage {
  const safeCursor = Math.min(Math.max(cursor, 0), messages.length)
  if (groupLimit <= 0 || safeCursor >= messages.length) {
    return { messages: [], nextCursor: safeCursor, hasMore: false }
  }

  const userIds = new Set<string>()
  const assistantAskIds = new Set<string>()
  const pageMessages: Message[] = []
  let nextCursor = safeCursor

  for (
    let index = messages.length - 1 - safeCursor;
    index >= 0 && userIds.size + assistantAskIds.size < groupLimit;
    index--
  ) {
    const message = messages[index]
    nextCursor++
    if (!message) continue

    const idSet = message.role === 'user' ? userIds : assistantAskIds
    const groupId = message.role === 'user' ? message.id : (message.askId ?? message.id)
    idSet.add(groupId)
    pageMessages.push(message)
  }

  return {
    messages: pageMessages,
    nextCursor,
    hasMore: nextCursor < messages.length
  }
}
