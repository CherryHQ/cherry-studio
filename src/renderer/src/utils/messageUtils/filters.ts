import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { isEmpty, remove } from 'lodash'

function getParts(message: Message): CherryMessagePart[] {
  return message.parts ?? []
}

function partsHaveText(parts: CherryMessagePart[]): boolean {
  return parts.some((p) => p.type === 'text' && !isEmpty(((p as { text?: string }).text ?? '').trim()))
}

/**
 * Filters out messages of type '@' or 'clear' and messages without main text content.
 */
export const filterMessages = (messages: Message[]) => {
  return messages
    .filter((message) => !['@', 'clear'].includes(message.type!))
    .filter((message) => partsHaveText(getParts(message)))
}

/**
 * Filters messages to include only those after the last 'clear' type message.
 */
export function filterAfterContextClearMessages(messages: Message[]): Message[] {
  const clearIndex = messages.findLastIndex((message) => message.type === 'clear')

  if (clearIndex === -1) {
    return messages
  }

  return messages.slice(clearIndex + 1)
}

/**
 * Filters messages to start from the first message with role 'user'.
 */
export function filterUserRoleStartMessages(messages: Message[]): Message[] {
  const firstUserMessageIndex = messages.findIndex((message) => message.role === 'user')

  if (firstUserMessageIndex === -1) {
    // Return empty array if no user message found, or original? Original returned messages.
    return messages
  }

  return messages.slice(firstUserMessageIndex)
}

/**
 * Filters out messages considered "empty". A message has content if any
 * part holds non-empty text, or carries a file, tool call, or data-code
 * block. Citations live on text parts via `providerMetadata.cherry.references`
 * so they don't need a separate branch here — a text part with a citation
 * also carries the text body.
 */
export function filterEmptyMessages(messages: Message[]): Message[] {
  return messages.filter((message) => {
    for (const part of getParts(message)) {
      if (part.type === 'text' && !isEmpty(((part as { text?: string }).text ?? '').trim())) return true
      if (part.type === 'file') return true
      if (part.type === 'data-code') return true
      const t = part.type as string
      if (t.startsWith('tool-') || t === 'dynamic-tool') return true
    }
    return false
  })
}

/**
 * Groups messages by user message ID or assistant askId.
 */
export function getGroupedMessages(messages: Message[]): { [key: string]: (Message & { index: number })[] } {
  const groups: { [key: string]: (Message & { index: number })[] } = {}
  messages.forEach((message, index) => {
    // Use askId if available (should be on assistant messages), otherwise group user messages individually
    const key = message.role === 'assistant' && message.askId ? 'assistant' + message.askId : message.role + message.id
    if (key && !groups[key]) {
      groups[key] = []
    }
    groups[key].push({ ...message, index }) // Add message with its original index
  })
  return groups
}

/**
 * Filters messages based on the 'useful' flag and message role sequences.
 * Only remain one message in a group. Either useful or fallback to the first message in the group.
 */
export function filterUsefulMessages(messages: Message[]): Message[] {
  const _messages = [...messages]
  const groupedMessages = getGroupedMessages(messages)

  Object.entries(groupedMessages).forEach(([key, groupedMsgs]) => {
    if (key.startsWith('assistant')) {
      const usefulMessage = groupedMsgs.find((m) => m.useful === true)
      if (usefulMessage) {
        // Remove all messages in the group except the useful one
        groupedMsgs.forEach((m) => {
          if (m.id !== usefulMessage.id) {
            remove(_messages, (o) => o.id === m.id)
          }
        })
      } else if (groupedMsgs.length > 0) {
        // Keep only the first message if none are marked useful
        const messagesToRemove = groupedMsgs.slice(1)
        messagesToRemove.forEach((m) => {
          remove(_messages, (o) => o.id === m.id)
        })
      }
    }
  })

  return _messages
}

export function filterAdjacentUserMessaegs(messages: Message[]): Message[] {
  // Filter adjacent user messages, keeping only the last one
  return messages.filter((message, index, origin) => {
    return !(message.role === 'user' && index + 1 < origin.length && origin[index + 1].role === 'user')
  })
}

/**
 * Filters out assistant messages that contain only error content (and their
 * associated user messages). An assistant message qualifies when it has at
 * least one `data-error` part and no other content-bearing parts.
 * `step-start` (AI SDK boundary marker) is ignored. Associated user messages
 * are matched via the `askId` field.
 */
export function filterErrorOnlyMessagesWithRelated(messages: Message[]): Message[] {
  const errorOnlyAskIds = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.askId) continue

    let hasError = false
    let hasNonError = false
    for (const part of getParts(message)) {
      if (part.type === 'data-error') hasError = true
      else if (part.type !== ('step-start' as string)) hasNonError = true
      if (hasError && hasNonError) break
    }
    if (hasError && !hasNonError) {
      errorOnlyAskIds.add(message.askId)
    }
  }

  // Filter out both the assistant messages and their associated user messages
  return messages.filter((message) => {
    // Remove assistant messages that only have ErrorBlocks
    if (message.role === 'assistant' && message.askId && errorOnlyAskIds.has(message.askId)) {
      return false
    }

    // Remove user messages that are associated with error-only assistant messages
    if (message.role === 'user' && errorOnlyAskIds.has(message.id)) {
      return false
    }

    return true
  })
}

// Note: getGroupedMessages might also need to be moved or imported.
// It depends on message.askId which should still exist on the Message type.
// export function getGroupedMessages(messages: Message[]): { [key: string]: (Message & { index: number })[] } {
//   const groups: { [key: string]: (Message & { index: number })[] } = {}
//   messages.forEach((message, index) => {
//     const key = message.askId ? 'assistant' + message.askId : 'user' + message.id
//     if (key && !groups[key]) {
//       groups[key] = []
//     }
//     groups[key].unshift({ ...message, index }) // Keep unshift if order matters for useful filter
//   })
//   return groups
// }
