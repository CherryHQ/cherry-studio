import store from '@renderer/store'
import { messageBlocksSelectors } from '@renderer/store/messageBlock'
import type {
  CitationBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  WebSearchMessageBlock
} from '@renderer/types/newMessageTypes'
import { MessageBlockType } from '@renderer/types/newMessageTypes'

/**
 * Finds the MainTextMessageBlock associated with a given message.
 * @param message - The message object.
 * @returns The MainTextMessageBlock or undefined if not found.
 */
export const findMainTextBlock = (message: Message): MainTextMessageBlock | undefined => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return undefined
  }
  const state = store.getState()
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.MAIN_TEXT) {
      return block as MainTextMessageBlock
    }
  }
  return undefined
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
 * Gets the content string from the MainTextMessageBlock of a message.
 * @param message - The message object.
 * @returns The content string or an empty string if not found.
 */
export const getMessageContent = (message: Message): string => {
  const mainTextBlock = findMainTextBlock(message)
  return mainTextBlock?.content || ''
}

/**
 * Gets the knowledgeBaseIds array from the MainTextMessageBlock of a message.
 * @param message - The message object.
 * @returns The knowledgeBaseIds array or undefined if not found.
 */
export const getKnowledgeBaseIds = (message: Message): string[] | undefined => {
  const mainTextBlock = findMainTextBlock(message)
  return mainTextBlock?.knowledgeBaseIds
}

/**
 * Finds all CitationBlocks associated with a given message.
 * @param message - The message object.
 * @returns An array of CitationBlocks (empty if none found).
 */
export const findCitationBlocks = (message: Message): CitationBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const citationBlocks: CitationBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.CITATION) {
      citationBlocks.push(block as CitationBlock)
    }
  }
  return citationBlocks
}

/**
 * Finds the WebSearchMessageBlock associated with a given message.
 * Assumes only one web search block per message.
 * @param message - The message object.
 * @returns The WebSearchMessageBlock or undefined if not found.
 */
export const findWebSearchBlock = (message: Message): WebSearchMessageBlock | undefined => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return undefined
  }
  const state = store.getState()
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.WEB_SEARCH) {
      return block as WebSearchMessageBlock
    }
  }
  return undefined
}

// You can add more helper functions here to find other block types if needed.
