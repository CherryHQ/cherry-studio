import { getTopicMessages } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import type { FileMetadata } from '@renderer/types/file'
import type { Topic } from '@renderer/types/topic'
import {
  analyzeMessageContent,
  CONTENT_TYPES,
  type ContentType,
  processMessageContent,
  type TopicContentStats,
  type TopicPreprocessResult
} from '@renderer/utils/knowledge'

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
