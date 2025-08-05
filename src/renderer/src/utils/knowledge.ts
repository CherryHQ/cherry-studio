import { TopicManager } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import type { FileType, Topic } from '@renderer/types'
import type { Message, MessageBlock } from '@renderer/types/newMessage'
import type {
  CitationMessageBlock,
  CodeMessageBlock,
  ErrorMessageBlock,
  FileMessageBlock,
  ImageMessageBlock,
  MainTextMessageBlock,
  ThinkingMessageBlock,
  ToolMessageBlock,
  TranslationMessageBlock
} from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'

import { findAllBlocks } from './messageUtils/find'

/**
 * 内容类型常量定义
 */
export const CONTENT_TYPES = {
  TEXT: 'text',
  CODE: 'code',
  THINKING: 'thinking',
  TOOL_USE: 'tools',
  CITATION: 'citations',
  TRANSLATION: 'translations',
  ERROR: 'errors',
  FILE: 'files',
  IMAGES: 'images'
} as const

export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES]

/**
 * 消息内容统计
 */
export interface MessageContentStats {
  text: number // 主文本块数量
  code: number // 代码块数量
  thinking: number // 思考块数量
  images: number // 图片数量
  files: number // 文件数量
  tools: number // 工具调用数量
  citations: number // 引用数量
  translations: number // 翻译数量
  errors: number // 错误数量
}

/**
 * 话题内容统计（包含消息数量）
 */
export interface TopicContentStats extends MessageContentStats {
  messages: number // 消息数量
}

/**
 * 消息预处理结果
 */
export interface MessagePreprocessResult {
  // 合并后的文本内容
  text: string

  // 文件列表
  files: FileType[]
}

/**
 * 话题预处理结果
 */
export interface TopicPreprocessResult {
  // 合并后的文本内容（包含话题名称）
  text: string

  // 文件列表
  files: FileType[]
}

/**
 * 分析消息内容，统计各类型内容数量
 */
export function analyzeMessageContent(message: Message): MessageContentStats {
  const blocks = findAllBlocks(message)

  const stats: MessageContentStats = {
    text: 0,
    code: 0,
    thinking: 0,
    images: 0,
    files: 0,
    tools: 0,
    citations: 0,
    translations: 0,
    errors: 0
  }

  for (const block of blocks) {
    switch (block.type) {
      case MessageBlockType.MAIN_TEXT: {
        const mainTextBlock = block as MainTextMessageBlock
        if (mainTextBlock.content?.trim()) {
          stats.text++
        }
        break
      }
      case MessageBlockType.CODE: {
        const codeBlock = block as CodeMessageBlock
        if (codeBlock.content?.trim()) {
          stats.code++
        }
        break
      }
      case MessageBlockType.THINKING:
        stats.thinking++
        break
      case MessageBlockType.TOOL:
        stats.tools++
        break
      case MessageBlockType.IMAGE:
        stats.images++
        break
      case MessageBlockType.FILE:
        stats.files++
        break
      case MessageBlockType.CITATION:
        stats.citations++
        break
      case MessageBlockType.TRANSLATION:
        stats.translations++
        break
      case MessageBlockType.ERROR:
        stats.errors++
        break
      case MessageBlockType.UNKNOWN:
        // 占位符块不计入统计
        break
    }
  }

  return stats
}

/**
 * 根据选择的内容类型，处理消息内容
 * 将选中的文本类型合并为字符串，提取文件列表
 */
export function processMessageContent(message: Message, selectedTypes: ContentType[]): MessagePreprocessResult {
  const blocks = findAllBlocks(message)
  const textParts: string[] = []
  const files: FileType[] = []

  // 提高查找效率
  const selectedTypeSet = new Set(selectedTypes)

  for (const block of blocks) {
    // 处理文本内容
    const textContent = processTextlikeBlocks(block, selectedTypeSet)
    if (textContent.trim()) {
      textParts.push(textContent)
    }

    // 处理文件内容
    if (selectedTypeSet.has(CONTENT_TYPES.FILE)) {
      const fileContent = processFileBlocks(block)
      if (fileContent) {
        files.push(fileContent)
      }
    }
  }

  return {
    text: textParts.join('\n\n'),
    files
  }
}

/**
 * 处理所选类型的文本内容
 */
function processTextlikeBlocks(block: MessageBlock, selectedTypes: Set<ContentType>): string {
  switch (block.type) {
    case MessageBlockType.MAIN_TEXT: {
      if (!selectedTypes.has(CONTENT_TYPES.TEXT)) return ''
      const mainTextBlock = block as MainTextMessageBlock
      return mainTextBlock.content || ''
    }

    case MessageBlockType.CODE: {
      if (!selectedTypes.has(CONTENT_TYPES.CODE)) return ''
      const codeBlock = block as CodeMessageBlock
      return codeBlock.content || ''
    }

    case MessageBlockType.THINKING: {
      if (!selectedTypes.has(CONTENT_TYPES.THINKING)) return ''
      const thinkingBlock = block as ThinkingMessageBlock
      const thinkingContent = thinkingBlock.content || ''
      return `<think>\n${thinkingContent}\n</think>`
    }

    case MessageBlockType.TOOL: {
      if (!selectedTypes.has(CONTENT_TYPES.TOOL_USE)) return ''
      const toolBlock = block as ToolMessageBlock
      const rawResponse = toolBlock.metadata?.rawMcpToolResponse
      const toolInfo = {
        id: toolBlock.toolId,
        name: toolBlock.toolName || '',
        description: rawResponse?.tool?.description,
        arguments: rawResponse?.arguments,
        status: rawResponse?.status,
        response: rawResponse?.response
      }
      return `<tool>\n${JSON.stringify(toolInfo, null, 2)}\n</tool>`
    }

    case MessageBlockType.IMAGE: {
      if (!selectedTypes.has(CONTENT_TYPES.IMAGES)) return ''
      const imageBlock = block as ImageMessageBlock
      if (imageBlock.file) {
        return `<image id="${imageBlock.id}" filename="${imageBlock.file.name}" type="${imageBlock.file.type}" />`
      } else if (imageBlock.url) {
        return `<image id="${imageBlock.id}" url="${imageBlock.url}" />`
      }
      return `<image id="${imageBlock.id}" />`
    }

    case MessageBlockType.FILE: {
      // 文件信息在文本中只作为元信息记录，实际文件在files数组中
      if (!selectedTypes.has(CONTENT_TYPES.FILE)) return ''
      const fileBlock = block as FileMessageBlock
      return `<file id="${fileBlock.id}" filename="${fileBlock.file.name}" type="${fileBlock.file.type}" size="${fileBlock.file.size}" />`
    }

    case MessageBlockType.CITATION: {
      if (!selectedTypes.has(CONTENT_TYPES.CITATION)) return ''
      const citationBlock = block as CitationMessageBlock
      const citationInfo = {
        id: citationBlock.id,
        response: citationBlock.response,
        knowledge: citationBlock.knowledge
      }
      if (citationInfo.response || citationInfo.knowledge) {
        return `<citation id="${citationInfo.id}">\n${JSON.stringify(citationInfo, null, 2)}\n</citation>`
      }
      return `<citation id="${citationInfo.id}" />`
    }

    case MessageBlockType.ERROR: {
      if (!selectedTypes.has(CONTENT_TYPES.ERROR)) return ''
      const errorBlock = block as ErrorMessageBlock
      const errorContent = errorBlock.error ? JSON.stringify(errorBlock.error) : 'Error occurred'
      return `<error>\n${errorContent}\n</error>`
    }

    case MessageBlockType.TRANSLATION: {
      if (!selectedTypes.has(CONTENT_TYPES.TRANSLATION)) return ''
      const translationBlock = block as TranslationMessageBlock
      return `<translation target="${translationBlock.targetLanguage}">\n${translationBlock.content}\n</translation>`
    }

    case MessageBlockType.UNKNOWN:
      // 占位符块，通常不需要输出内容
      return ''

    default: {
      // 未知类型的处理
      const unknownBlock = block as MessageBlock
      return `<${unknownBlock.type} id="${unknownBlock.id}" />`
    }
  }
}

/**
 * 处理文件块
 */
function processFileBlocks(block: MessageBlock): FileType | null {
  switch (block.type) {
    case MessageBlockType.FILE: {
      const fileBlock = block as FileMessageBlock
      return fileBlock.file
    }

    // 未来可能扩展其他类型
    default:
      return null
  }
}

/**
 * 分析话题内容，统计各类型内容数量
 * @param topic 话题对象
 * @returns 话题内容统计
 */
export async function analyzeTopicContent(topic: Topic): Promise<TopicContentStats> {
  // 获取话题的所有消息
  const messages = await TopicManager.getTopicMessages(topic.id)

  const stats: TopicContentStats = {
    text: 0,
    code: 0,
    thinking: 0,
    images: 0,
    files: 0,
    tools: 0,
    citations: 0,
    translations: 0,
    errors: 0,
    messages: messages.length
  }

  // 分析每个消息的内容
  for (const message of messages) {
    const messageStats = analyzeMessageContent(message)

    // 累加各类型统计
    stats.text += messageStats.text
    stats.code += messageStats.code
    stats.thinking += messageStats.thinking
    stats.images += messageStats.images
    stats.files += messageStats.files
    stats.tools += messageStats.tools
    stats.citations += messageStats.citations
    stats.translations += messageStats.translations
    stats.errors += messageStats.errors
  }

  return stats
}

/**
 * 根据选择的内容类型，处理话题内容
 * 将选中的文本类型合并为字符串，提取文件列表
 * @param topic 话题对象
 * @param selectedTypes 选择的内容类型
 * @returns 话题预处理结果
 */
export async function processTopicContent(topic: Topic, selectedTypes: ContentType[]): Promise<TopicPreprocessResult> {
  // 获取话题的所有消息
  const messages = await TopicManager.getTopicMessages(topic.id)

  const textParts: string[] = []
  const files: FileType[] = []

  // 添加话题标题（如果选择了文本类型）
  const selectedTypeSet = new Set(selectedTypes)
  if (selectedTypeSet.has(CONTENT_TYPES.TEXT)) {
    textParts.push(`# ${topic.name}`)
  }

  // 处理每个消息
  for (const message of messages) {
    const messageResult = processMessageContent(message, selectedTypes)

    // 合并文本内容
    if (messageResult.text.trim()) {
      const rolePrefix = message.role === 'user' ? `## ${i18n.t('common.you')}：` : `## ${i18n.t('common.assistant')}：`
      textParts.push(`${rolePrefix}\n\n${messageResult.text}`)
    }

    // 合并文件内容
    files.push(...messageResult.files)
  }

  return {
    text: textParts.join('\n\n---\n\n'),
    files
  }
}
