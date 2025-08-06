import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { Message } from '@renderer/types/newMessage' // Assuming correct Message type import
import { MessageBlockType } from '@renderer/types/newMessage'
// May need Block types if refactoring to use them
// import type { MessageBlock, MainTextMessageBlock } from '@renderer/types/newMessageTypes';
import { remove, takeRight } from 'lodash'
import { isEmpty } from 'lodash'
// Assuming getGroupedMessages is also moved here or imported
// import { getGroupedMessages } from './path/to/getGroupedMessages';

// const logger = loggerService.withContext('Utils.filter')

/**
 * Filters out messages of type '@' or 'clear' and messages without main text content.
 */
export const filterMessages = (messages: Message[]) => {
  return messages
    .filter((message) => !['@', 'clear'].includes(message.type!))
    .filter((message) => {
      const state = store.getState()
      const mainTextBlock = message.blocks
        ?.map((blockId) => messageBlocksSelectors.selectById(state, blockId))
        .find((block) => block?.type === MessageBlockType.MAIN_TEXT)
      return !isEmpty((mainTextBlock as any)?.content?.trim()) // Type assertion needed
    })
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
 * Filters out messages considered "empty" based on block content.
 */
export function filterEmptyMessages(messages: Message[]): Message[] {
  return messages.filter((message) => {
    const state = store.getState()
    let hasContent = false
    for (const blockId of message.blocks) {
      const block = messageBlocksSelectors.selectById(state, blockId)
      if (!block) continue
      if (block.type === MessageBlockType.MAIN_TEXT && !isEmpty((block as any).content?.trim())) {
        // Type assertion needed
        hasContent = true
        break
      }
      if (
        [
          MessageBlockType.IMAGE,
          MessageBlockType.FILE,
          MessageBlockType.CODE,
          MessageBlockType.TOOL,
          MessageBlockType.CITATION
        ].includes(block.type)
      ) {
        hasContent = true
        break
      }
    }
    return hasContent
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
 * Only remain one message in a group. Either useful or fallback to the last message in the group.
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

export function filterLastAssistantMessage(messages: Message[]): Message[] {
  const _messages = [...messages]
  // Remove trailing assistant messages
  while (_messages.length > 0 && _messages[_messages.length - 1].role === 'assistant') {
    _messages.pop()
  }
  return _messages
}

export function filterAdjacentUserMessaegs(messages: Message[]): Message[] {
  // Filter adjacent user messages, keeping only the last one
  return messages.filter((message, index, origin) => {
    return !(message.role === 'user' && index + 1 < origin.length && origin[index + 1].role === 'user')
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

/**
 * Filters and processes messages based on context requirements
 * @param messages - Array of messages to be filtered
 * @param contextCount - Number of messages to keep in context (excluding new user and assistant messages)
 * @returns Filtered array of messages that:
 * 1. Only includes messages after the last context clear
 * 2. Only includes useful message in a group (based on useful flag)
 * 3. Limited to contextCount + 2 messages (including space for new user/assistant messages)
 * 4. Starts from first user message
 * 5. Excludes empty messages
 */
export function filterContextMessages(messages: Message[], contextCount: number): Message[] {
  // NOTE: 和 fetchCompletions 中过滤消息的逻辑相同。
  // 按理说 fetchCompletions 也可以复用这个函数，不过 fetchCompletions 不敢随便乱改，后面再考虑重构吧
  const afterContextClearMsgs = filterAfterContextClearMessages(messages)
  const usefulMsgs = filterUsefulMessages(afterContextClearMsgs)
  const adjacentRemovedMsgs = filterAdjacentUserMessaegs(usefulMsgs)
  const filteredMessages = filterUserRoleStartMessages(
    filterEmptyMessages(takeRight(adjacentRemovedMsgs, contextCount))
  )

  return filteredMessages
}
