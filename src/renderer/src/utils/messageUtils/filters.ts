import type { Message } from '@renderer/types/newMessageTypes' // Assuming correct Message type import
// May need Block types if refactoring to use them
// import type { MessageBlock, MainTextMessageBlock } from '@renderer/types/newMessageTypes';
import { remove } from 'lodash'
// Assuming getGroupedMessages is also moved here or imported
// import { getGroupedMessages } from './path/to/getGroupedMessages';

/**
 * Filters out messages of type '@' or 'clear'.
 * NOTE: The original also filtered by isEmpty(message.content.trim()),
 * which is commented out as `content` is no longer on the Message object.
 * This filter needs access to block data for content checks.
 */
export const filterMessages = (messages: Message[]) => {
  return messages.filter((message) => !['@', 'clear'].includes(message.type!))
  // .filter((message) => !isEmpty(message.content.trim())) // Requires block data access
}

/**
 * Filters messages to include only those after the last 'clear' type message.
 */
export function filterContextMessages(messages: Message[]): Message[] {
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
 * Filters out messages considered "empty".
 * NOTE: Original logic relied on `message.content` (string or array) and `message.files`.
 * This needs refactoring to check relevant blocks (e.g., MainText, File) for emptiness.
 * The current implementation is incomplete without block data access.
 */
export function filterEmptyMessages(messages: Message[]): Message[] {
  return messages.filter((_message) => {
    // TODO: Refactor required. Need access to blocks from messageBlocksSlice.
    // Example (conceptual):
    // const mainTextBlock = getMainTextBlockForMessage(message.id); // Needs selector
    // const fileBlocks = getFileBlocksForMessage(message.id); // Needs selector
    // if (mainTextBlock && !isEmpty(mainTextBlock.content.trim())) return true;
    // if (fileBlocks && fileBlocks.length > 0) return true;
    // // Add checks for other relevant block types...
    // return false; // Default to filtering out if no non-empty block found

    // Placeholder: Returning true for now to avoid filtering everything.
    console.warn('filterEmptyMessages needs refactoring for block-based content check.')
    return true
  })
}

/**
 * Filters messages based on the 'useful' flag and message role sequences.
 * NOTE: Depends on `getGroupedMessages`. Ensure that function is available.
 * The logic itself doesn't directly depend on `message.content`.
 */
export function filterUsefulMessages(
  messages: Message[],
  getGroupedMessages: (messages: Message[]) => { [key: string]: (Message & { index: number })[] }
): Message[] {
  let _messages = [...messages]
  const groupedMessages = getGroupedMessages(messages)

  Object.entries(groupedMessages).forEach(([key, groupedMsgs]) => {
    // Renamed inner 'messages' to 'groupedMsgs'
    if (key.startsWith('assistant')) {
      const usefulMessage = groupedMsgs.find((m) => m.useful === true)
      if (usefulMessage) {
        groupedMsgs.forEach((m) => {
          if (m.id !== usefulMessage.id) {
            remove(_messages, (o) => o.id === m.id)
          }
        })
      } else if (groupedMsgs.length > 0) {
        // Ensure there are messages before slicing
        // Keep only the last message if none are marked useful
        groupedMsgs.slice(0, -1).forEach((m) => {
          remove(_messages, (o) => o.id === m.id)
        })
      }
    }
  })

  // Remove trailing assistant messages (if any remain after filtering)
  while (_messages.length > 0 && _messages[_messages.length - 1].role === 'assistant') {
    _messages.pop()
  }

  // Filter adjacent user messages, keeping only the last one
  _messages = _messages.filter((message, index, origin) => {
    if (message.role === 'user' && index + 1 < origin.length && origin[index + 1].role === 'user') {
      return false
    }
    return true
  })

  return _messages
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
