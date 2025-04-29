import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type {
  CitationMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  ThinkingMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'

/**
 * Finds all MainTextMessageBlocks associated with a given message, in order.
 * @param message - The message object.
 * @returns An array of MainTextMessageBlocks (empty if none found).
 */
export const findMainTextBlocks = (message: Message): MainTextMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const textBlocks: MainTextMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.MAIN_TEXT) {
      textBlocks.push(block as MainTextMessageBlock)
    }
  }
  return textBlocks
}

export const findThinkingBlocks = (message: Message): ThinkingMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const thinkingBlocks: ThinkingMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.THINKING) {
      thinkingBlocks.push(block as ThinkingMessageBlock)
    }
  }
  return thinkingBlocks
}

/**
 * Finds all ImageMessageBlocks associated with a given message.
 * @param message - The message object.
 * @returns An array of ImageMessageBlocks (empty if none found).
 */
export const findImageBlocks = (message: Message): ImageMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const imageBlocks: ImageMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.IMAGE) {
      imageBlocks.push(block as ImageMessageBlock)
    }
  }
  return imageBlocks
}

/**
 * Finds all FileMessageBlocks associated with a given message.
 * @param message - The message object.
 * @returns An array of FileMessageBlocks (empty if none found).
 */
export const findFileBlocks = (message: Message): FileMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const fileBlocks: FileMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.FILE) {
      fileBlocks.push(block as FileMessageBlock)
    }
  }
  return fileBlocks
}

/**
 * Gets the concatenated content string from all MainTextMessageBlocks of a message, in order.
 * @param message - The message object.
 * @returns The concatenated content string or an empty string if no text blocks are found.
 */
export const getMainTextContent = (message: Message): string => {
  const textBlocks = findMainTextBlocks(message)
  return textBlocks.map((block) => block.content).join('\n\n')
}

export const getThinkingContent = (message: Message): string => {
  const thinkingBlocks = findThinkingBlocks(message)
  return thinkingBlocks.map((block) => block.content).join('\n\n')
}

/**
 * Gets the knowledgeBaseIds array from the *first* MainTextMessageBlock of a message.
 * Note: Assumes knowledgeBaseIds are only relevant on the first text block, adjust if needed.
 * @param message - The message object.
 * @returns The knowledgeBaseIds array or undefined if not found.
 */
export const getKnowledgeBaseIds = (message: Message): string[] | undefined => {
  const firstTextBlock = findMainTextBlocks(message)
  return firstTextBlock?.flatMap((block) => block.knowledgeBaseIds).filter((id): id is string => Boolean(id))
}

/**
 * Finds all CitationBlocks associated with a given message.
 * @param message - The message object.
 * @returns An array of CitationBlocks (empty if none found).
 */
export const findCitationBlocks = (message: Message): CitationMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const citationBlocks: CitationMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.CITATION) {
      citationBlocks.push(block as CitationMessageBlock)
    }
  }
  return citationBlocks
}

/**
 * Finds the WebSearchMessageBlock associated with a given message.
 * Assumes only one web search block per message.
 * @param message - The message object.
 * @returns The WebSearchMessageBlock or undefined if not found.
 * @deprecated Web search results are now part of CitationMessageBlock.
 */
/* // Removed function
export const findWebSearchBlock = (message: Message): WebSearchMessageBlock | undefined => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return undefined
  }
  const state = store.getState()
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.WEB_SEARCH) { // Error here too
      return block as WebSearchMessageBlock
    }
  }
  return undefined
}
*/

// You can add more helper functions here to find other block types if needed.
