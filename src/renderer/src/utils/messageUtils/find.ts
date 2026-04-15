import store from '@renderer/store'
import { formatCitationsFromBlock, messageBlocksSelectors } from '@renderer/store/messageBlock'
import type { FileMetadata } from '@renderer/types'
import type {
  CitationMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  Message,
  MessageBlock,
  ThinkingMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'

/**
 * Block entity lookup map — either from V2BlockContext or Redux.
 * When callers pass this, Redux is bypassed entirely.
 */
type BlockEntities = Record<string, MessageBlock | undefined>

/**
 * Resolve block entities: use the provided map if available, otherwise fall back to Redux.
 */
function resolveBlockEntities(entities?: BlockEntities): BlockEntities {
  if (entities) return entities
  const state = store.getState()
  return messageBlocksSelectors.selectEntities(state)
}

export const findAllBlocks = (message: Message, blockEntities?: BlockEntities): MessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const entities = resolveBlockEntities(blockEntities)
  const allBlocks: MessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = entities[blockId]
    if (block) {
      allBlocks.push(block)
    }
  }
  return allBlocks
}

/**
 * Finds all MainTextMessageBlocks associated with a given message, in order.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns An array of MainTextMessageBlocks (empty if none found).
 */
export const findMainTextBlocks = (message: Message, blockEntities?: BlockEntities): MainTextMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const entities = resolveBlockEntities(blockEntities)
  const textBlocks: MainTextMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = entities[blockId]
    if (block && block.type === MessageBlockType.MAIN_TEXT) {
      textBlocks.push(block)
    }
  }
  return textBlocks
}

/**
 * Finds all ThinkingMessageBlocks associated with a given message.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns An array of ThinkingMessageBlocks (empty if none found).
 */
export const findThinkingBlocks = (message: Message, blockEntities?: BlockEntities): ThinkingMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const entities = resolveBlockEntities(blockEntities)
  const thinkingBlocks: ThinkingMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = entities[blockId]
    if (block && block.type === MessageBlockType.THINKING) {
      thinkingBlocks.push(block)
    }
  }
  return thinkingBlocks
}

/**
 * Finds all ImageMessageBlocks associated with a given message.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns An array of ImageMessageBlocks (empty if none found).
 */
export const findImageBlocks = (message: Message, blockEntities?: BlockEntities): ImageMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const entities = resolveBlockEntities(blockEntities)
  const imageBlocks: ImageMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = entities[blockId]
    if (block && block.type === MessageBlockType.IMAGE) {
      imageBlocks.push(block)
    }
  }
  return imageBlocks
}

/**
 * Finds all FileMessageBlocks associated with a given message.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns An array of FileMessageBlocks (empty if none found).
 */
export const findFileBlocks = (message: Message, blockEntities?: BlockEntities): FileMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const entities = resolveBlockEntities(blockEntities)
  const fileBlocks: FileMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = entities[blockId]
    if (block && block.type === MessageBlockType.FILE) {
      fileBlocks.push(block)
    }
  }
  return fileBlocks
}

/**
 * Gets the concatenated content string from all MainTextMessageBlocks of a message, in order.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns The concatenated content string or an empty string if no text blocks are found.
 */
export const getMainTextContent = (message: Message, blockEntities?: BlockEntities): string => {
  const textBlocks = findMainTextBlocks(message, blockEntities)
  return textBlocks.map((block) => block.content).join('\n\n')
}

/**
 * Gets the concatenated content string from all ThinkingMessageBlocks of a message, in order.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns The concatenated content string or an empty string if no thinking blocks are found.
 */
export const getThinkingContent = (message: Message, blockEntities?: BlockEntities): string => {
  const thinkingBlocks = findThinkingBlocks(message, blockEntities)
  return thinkingBlocks.map((block) => block.content).join('\n\n')
}

/**
 * Finds all CitationBlocks associated with a given message.
 * Internal helper for {@link getCitationContent}.
 */
const findCitationBlocks = (message: Message, blockEntities?: BlockEntities): CitationMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const entities = resolveBlockEntities(blockEntities)
  const citationBlocks: CitationMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = entities[blockId]
    if (block && block.type === MessageBlockType.CITATION) {
      citationBlocks.push(block)
    }
  }
  return citationBlocks
}

export const getCitationContent = (message: Message, blockEntities?: BlockEntities): string => {
  const citationBlocks = findCitationBlocks(message, blockEntities)
  return citationBlocks
    .map((block) => formatCitationsFromBlock(block))
    .flat()
    .map(
      (citation) =>
        `[${citation.number}] [${citation.title || citation.url.slice(0, 1999)}](${citation.url.slice(0, 1999)})`
    )
    .join('\n\n')
}

/**
 * Gets the file content from all FileMessageBlocks and ImageMessageBlocks of a message.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns The file content or an empty string if no file blocks are found.
 */
export const getFileContent = (message: Message, blockEntities?: BlockEntities): FileMetadata[] => {
  const files: FileMetadata[] = []
  const fileBlocks = findFileBlocks(message, blockEntities)
  for (const block of fileBlocks) {
    if (block.file) {
      files.push(block.file)
    }
  }
  const imageBlocks = findImageBlocks(message, blockEntities)
  for (const block of imageBlocks) {
    if (block.file) {
      files.push(block.file)
    }
  }
  return files
}
