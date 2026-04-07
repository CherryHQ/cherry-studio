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
  ThinkingMessageBlock,
  TranslationMessageBlock
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
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns An array of CitationBlocks (empty if none found).
 */
export const findCitationBlocks = (message: Message, blockEntities?: BlockEntities): CitationMessageBlock[] => {
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

/**
 * Finds all TranslationMessageBlocks associated with a given message.
 * @param message - The message object.
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns An array of TranslationMessageBlocks (empty if none found).
 */
export const findTranslationBlocks = (message: Message, blockEntities?: BlockEntities): TranslationMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const entities = resolveBlockEntities(blockEntities)
  const translationBlocks: TranslationMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = entities[blockId]
    if (block && block.type === MessageBlockType.TRANSLATION) {
      translationBlocks.push(block)
    }
  }
  return translationBlocks
}

/**
 * 通过消息ID从状态中查询最新的消息，并返回其中的翻译块
 * @param id - 消息ID
 * @param blockEntities - Optional pre-resolved block map (V2 mode). Falls back to Redux.
 * @returns 翻译块数组，如果消息不存在则返回空数组
 */
export const findTranslationBlocksById = (id: string, blockEntities?: BlockEntities): TranslationMessageBlock[] => {
  const state = store.getState()
  const message = state.messages.entities[id]
  return findTranslationBlocks(message, blockEntities)
}

/**
 * 构造带工具调用结果的消息内容
 * @deprecated
 */
export function getContentWithTools(message: Message, blockEntities?: BlockEntities) {
  const blocks = findAllBlocks(message, blockEntities)
  let constructedContent = ''
  for (const block of blocks) {
    if (block.type === MessageBlockType.MAIN_TEXT || block.type === MessageBlockType.TOOL) {
      if (block.type === MessageBlockType.MAIN_TEXT) {
        constructedContent += block.content
      } else if (block.type === MessageBlockType.TOOL) {
        let resultString =
          '\n\nAssistant called a tool.\nTool Name:' +
          block.metadata?.rawMcpToolResponse?.tool.name +
          '\nTool call result: \n```json\n'
        try {
          resultString += JSON.stringify(
            {
              params: block.metadata?.rawMcpToolResponse?.arguments,
              response: block.metadata?.rawMcpToolResponse?.response
            },
            null,
            2
          )
        } catch (e) {
          resultString += 'Invalid Result'
        }
        constructedContent += resultString + '\n```\n\n'
      }
    }
  }
  return constructedContent
}
