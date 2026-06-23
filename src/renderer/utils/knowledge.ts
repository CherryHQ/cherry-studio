import { getTopicMessages } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import type { FileMetadata, Topic } from '@renderer/types'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { CodePartData, ErrorPartData, TranslationPartData } from '@shared/data/types/uiParts'

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
  files: FileMetadata[]
}

/**
 * 话题预处理结果
 */
export interface TopicPreprocessResult {
  // 合并后的文本内容（包含话题名称）
  text: string

  // 文件列表
  files: FileMetadata[]
}

// ── Parts helpers ────────────────────────────────────────────────────
// Read content units directly from `Message.parts` (CherryMessagePart[]).
// V2 has no standalone citation parts — citations live on text-part metadata
// and were never surfaced by the v1 block path either, so they stay at 0.

type FilePartLike = { type: 'file'; mediaType?: string; url?: string; filename?: string }

function filePartUrlToPath(url: string): string {
  if (!url.startsWith('file://')) return url

  try {
    const pathname = decodeURIComponent(new URL(url).pathname)
    if (/^\/[A-Za-z]:\//.test(pathname)) return pathname.slice(1).replace(/\//g, '\\')
    return pathname
  } catch {
    return url.replace(/^file:\/\//, '')
  }
}

function getParts(message: ExportableMessage): CherryMessagePart[] {
  return message.parts ?? []
}

function getDataPart<T>(part: CherryMessagePart): Partial<T> | undefined {
  if ('data' in part && part.data && typeof part.data === 'object') {
    return part.data as Partial<T>
  }
  return undefined
}

function isToolPart(type: string): boolean {
  return type.startsWith('tool-') || type === 'dynamic-tool'
}

function isImageFilePart(part: FilePartLike): boolean {
  return Boolean(part.mediaType?.startsWith('image/'))
}

/**
 * 分析消息内容，统计各类型内容数量
 */
export function analyzeMessageContent(message: ExportableMessage): MessageContentStats {
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

  for (const part of getParts(message)) {
    switch (part.type) {
      case 'text':
        if ((part.text ?? '').trim()) stats.text++
        break
      case 'reasoning':
        stats.thinking++
        break
      case 'data-code':
        if ((getDataPart<CodePartData>(part)?.content ?? '').trim()) stats.code++
        break
      case 'data-error':
        stats.errors++
        break
      case 'data-translation':
        stats.translations++
        break
      case 'file': {
        const filePart = part as FilePartLike
        if (isImageFilePart(filePart)) stats.images++
        else if (filePart.url) stats.files++
        break
      }
      default:
        if (isToolPart(part.type)) stats.tools++
        break
    }
  }

  return stats
}

/**
 * 根据选择的内容类型，处理消息内容
 * 将选中的文本类型合并为字符串，提取文件列表
 */
export function processMessageContent(
  message: ExportableMessage,
  selectedTypes: ContentType[]
): MessagePreprocessResult {
  const textParts: string[] = []
  const files: FileMetadata[] = []

  // 提高查找效率
  const selectedTypeSet = new Set(selectedTypes)

  getParts(message).forEach((part, index) => {
    // 处理文本内容
    const textContent = processTextlikePart(part, index, message.id, selectedTypeSet)
    if (textContent.trim()) {
      textParts.push(textContent)
    }

    // 处理文件内容
    if (selectedTypeSet.has(CONTENT_TYPES.FILE)) {
      const fileContent = filePartToMetadata(part)
      if (fileContent) {
        files.push(fileContent)
      }
    }
  })

  return {
    text: textParts.join('\n\n'),
    files
  }
}

/**
 * 处理所选类型的文本内容
 */
function processTextlikePart(
  part: CherryMessagePart,
  index: number,
  messageId: string,
  selectedTypes: Set<ContentType>
): string {
  const partId = `${messageId}-part-${index}`

  switch (part.type) {
    case 'text': {
      if (!selectedTypes.has(CONTENT_TYPES.TEXT)) return ''
      return part.text || ''
    }

    case 'data-code': {
      if (!selectedTypes.has(CONTENT_TYPES.CODE)) return ''
      return getDataPart<CodePartData>(part)?.content || ''
    }

    case 'reasoning': {
      if (!selectedTypes.has(CONTENT_TYPES.THINKING)) return ''
      return `<think>\n${part.text || ''}\n</think>`
    }

    case 'data-error': {
      if (!selectedTypes.has(CONTENT_TYPES.ERROR)) return ''
      const data = getDataPart<ErrorPartData>(part)
      const error = data
        ? { name: data.name ?? undefined, message: data.message ?? data.code ?? 'Error occurred', stack: data.stack }
        : undefined
      const errorContent = error ? JSON.stringify(error) : 'Error occurred'
      return `<error>\n${errorContent}\n</error>`
    }

    case 'data-translation': {
      if (!selectedTypes.has(CONTENT_TYPES.TRANSLATION)) return ''
      const data = getDataPart<TranslationPartData>(part)
      return `<translation target="${data?.targetLanguage ?? ''}">\n${data?.content ?? ''}\n</translation>`
    }

    case 'file': {
      const filePart = part as FilePartLike
      if (isImageFilePart(filePart)) {
        if (!selectedTypes.has(CONTENT_TYPES.IMAGES)) return ''
        if (filePart.url) {
          return `<image id="${partId}" filename="${filePart.filename ?? ''}" type="${filePart.mediaType ?? ''}" />`
        }
        return `<image id="${partId}" />`
      }
      // 文件信息在文本中只作为元信息记录，实际文件在files数组中
      if (!selectedTypes.has(CONTENT_TYPES.FILE)) return ''
      if (!filePart.url) return ''
      return `<file id="${partId}" filename="${filePart.filename ?? ''}" type="${filePart.mediaType ?? ''}" />`
    }

    default: {
      if (!isToolPart(part.type)) return ''
      if (!selectedTypes.has(CONTENT_TYPES.TOOL_USE)) return ''
      const toolInfo = {
        id: (part as { toolCallId?: string }).toolCallId ?? partId,
        name: ''
      }
      return `<tool>\n${JSON.stringify(toolInfo, null, 2)}\n</tool>`
    }
  }
}

/**
 * 将非图片文件 part 转换为文件元信息（图片不计入文件列表）
 */
function filePartToMetadata(part: CherryMessagePart): FileMetadata | null {
  if (part.type !== 'file') return null
  const filePart = part as FilePartLike
  if (isImageFilePart(filePart)) return null
  if (!filePart.url) return null
  return {
    name: filePart.filename ?? '',
    path: filePartUrlToPath(filePart.url),
    type: filePart.mediaType ?? ''
  } as FileMetadata
}

/**
 * 分析话题内容，统计各类型内容数量
 * @param topic 话题对象
 * @returns 话题内容统计
 */
export async function analyzeTopicContent(topic: Topic): Promise<TopicContentStats> {
  const messages = await getTopicMessages(topic.id)

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
  const messages = await getTopicMessages(topic.id)

  const textParts: string[] = []
  const files: FileMetadata[] = []

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
