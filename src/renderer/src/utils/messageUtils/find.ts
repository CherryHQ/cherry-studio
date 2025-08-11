import store from '@renderer/store'
import { formatCitationsFromBlock, messageBlocksSelectors } from '@renderer/store/messageBlock'
import { FileMetadata } from '@renderer/types'
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

export const findAllBlocks = (message: Message): MessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const allBlocks: MessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block) {
      allBlocks.push(block)
    }
  }
  return allBlocks
}

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

/**
 * Finds all ThinkingMessageBlocks associated with a given message.
 * @param message - The message object.
 * @returns An array of ThinkingMessageBlocks (empty if none found).
 */
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

/**
 * Gets the concatenated content string from all ThinkingMessageBlocks of a message, in order.
 * @param message
 * @returns The concatenated content string or an empty string if no thinking blocks are found.
 */
export const getThinkingContent = (message: Message): string => {
  const thinkingBlocks = findThinkingBlocks(message)
  return thinkingBlocks.map((block) => block.content).join('\n\n')
}

export const getCitationContent = (message: Message): string => {
  const citationBlocks = findCitationBlocks(message)
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
 * @returns The file content or an empty string if no file blocks are found.
 */
export const getFileContent = (message: Message): FileMetadata[] => {
  const files: FileMetadata[] = []
  const fileBlocks = findFileBlocks(message)
  for (const block of fileBlocks) {
    if (block.file) {
      files.push(block.file)
    }
  }
  const imageBlocks = findImageBlocks(message)
  for (const block of imageBlocks) {
    if (block.file) {
      files.push(block.file)
    }
  }
  return files
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
 * Finds all TranslationMessageBlocks associated with a given message.
 * @param message - The message object.
 * @returns An array of TranslationMessageBlocks (empty if none found).
 */
export const findTranslationBlocks = (message: Message): TranslationMessageBlock[] => {
  if (!message || !message.blocks || message.blocks.length === 0) {
    return []
  }
  const state = store.getState()
  const translationBlocks: TranslationMessageBlock[] = []
  for (const blockId of message.blocks) {
    const block = messageBlocksSelectors.selectById(state, blockId)
    if (block && block.type === MessageBlockType.TRANSLATION) {
      translationBlocks.push(block as TranslationMessageBlock)
    }
  }
  return translationBlocks
}

/**
 * 通过消息ID从状态中查询最新的消息，并返回其中的翻译块
 * @param id - 消息ID
 * @returns 翻译块数组，如果消息不存在则返回空数组
 */
export const findTranslationBlocksById = (id: string): TranslationMessageBlock[] => {
  const state = store.getState()
  const message = state.messages.entities[id]
  return findTranslationBlocks(message)
}

/**
 * 构造带工具调用结果的消息内容
 * @deprecated
 * @param blocks
 * @returns
 */
export function getContentWithTools(message: Message) {
  const blocks = findAllBlocks(message)
  let constructedContent = ''
  for (const block of blocks) {
    if (block.type === MessageBlockType.MAIN_TEXT || block.type === MessageBlockType.TOOL) {
      if (block.type === MessageBlockType.MAIN_TEXT) {
        constructedContent += block.content
      } else if (block.type === MessageBlockType.TOOL) {
        // 如果是工具调用结果，为其添加文本消息
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
