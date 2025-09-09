import {
  AssistantMessageStatus,
  type CitationMessageBlock,
  type CodeMessageBlock,
  type ErrorMessageBlock,
  type FileMessageBlock,
  type ImageMessageBlock,
  type MainTextMessageBlock,
  Message,
  type MessageBlock,
  MessageBlockType,
  type PlaceholderMessageBlock,
  type ThinkingMessageBlock,
  type ToolMessageBlock,
  type TranslationMessageBlock,
  type VideoMessageBlock
} from '@renderer/types/newMessage'

/**
 * Checks if a message block is a Main Text block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a MainTextMessageBlock, false otherwise.
 */
export function isMainTextBlock(block: MessageBlock): block is MainTextMessageBlock {
  return block.type === MessageBlockType.MAIN_TEXT
}

/**
 * Checks if a message block is an Image block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is an ImageMessageBlock, false otherwise.
 */
export function isImageBlock(block: MessageBlock): block is ImageMessageBlock {
  return block.type === MessageBlockType.IMAGE
}

/**
 * Checks if a message block is a File block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a FileMessageBlock, false otherwise.
 */
export function isFileBlock(block: MessageBlock): block is FileMessageBlock {
  return block.type === MessageBlockType.FILE
}

/**
 * Checks if a message block is a Code block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a CodeMessageBlock, false otherwise.
 */
export function isCodeBlock(block: MessageBlock): block is CodeMessageBlock {
  return block.type === MessageBlockType.CODE
}

/**
 * Checks if a message block is a Thinking block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a ThinkingMessageBlock, false otherwise.
 */
export function isThinkingBlock(block: MessageBlock): block is ThinkingMessageBlock {
  return block.type === MessageBlockType.THINKING
}

/**
 * Checks if a message block is an Error block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is an ErrorMessageBlock, false otherwise.
 */
export function isErrorBlock(block: MessageBlock): block is ErrorMessageBlock {
  return block.type === MessageBlockType.ERROR
}

/**
 * Checks if a message block is a Translation block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a TranslationMessageBlock, false otherwise.
 */
export function isTranslationBlock(block: MessageBlock): block is TranslationMessageBlock {
  return block.type === MessageBlockType.TRANSLATION
}

/**
 * Checks if a message block is generally text-based (has a string content property).
 * This includes MAIN_TEXT, THINKING, TRANSLATION, CODE, ERROR.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is one of the text-like types, false otherwise.
 */
export function isTextLikeBlock(
  block: MessageBlock
): block is
  | MainTextMessageBlock
  | ThinkingMessageBlock
  | TranslationMessageBlock
  | CodeMessageBlock
  | ErrorMessageBlock {
  return (
    block.type === MessageBlockType.MAIN_TEXT ||
    block.type === MessageBlockType.THINKING ||
    block.type === MessageBlockType.TRANSLATION ||
    block.type === MessageBlockType.CODE ||
    block.type === MessageBlockType.ERROR
  )
}

/**
 * Checks if a message block is a Video block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a VideoMessageBlock, false otherwise.
 */
export function isVideoBlock(block: MessageBlock): block is VideoMessageBlock {
  return block.type === MessageBlockType.VIDEO
}

/**
 * Checks if a message block is a Tool block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a ToolMessageBlock, false otherwise.
 */
export function isToolBlock(block: MessageBlock): block is ToolMessageBlock {
  return block.type === MessageBlockType.TOOL
}

/**
 * Checks if a message block is a Citation block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a CitationMessageBlock, false otherwise.
 */
export function isCitationBlock(block: MessageBlock): block is CitationMessageBlock {
  return block.type === MessageBlockType.CITATION
}

/**
 * Checks if a message block is a Placeholder block.
 * Acts as a TypeScript type guard.
 * @param block - The message block to check.
 * @returns True if the block is a PlaceholderMessageBlock, false otherwise.
 */
export function isPlaceholderBlock(block: MessageBlock): block is PlaceholderMessageBlock {
  return block.type === MessageBlockType.UNKNOWN
}

export function isMessageProcessing(message: Message): boolean {
  return (
    message.status === AssistantMessageStatus.PROCESSING ||
    message.status === AssistantMessageStatus.PENDING ||
    message.status === AssistantMessageStatus.SEARCHING
  )
}
