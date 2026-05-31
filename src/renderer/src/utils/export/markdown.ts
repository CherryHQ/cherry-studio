import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { captureScrollableAsBlob, captureScrollableAsDataURL } from '@renderer/utils/image'

import { createBaseMarkdown, getRoleText, getTitleFromString, processCitations, sanitizeReasoningContent } from './utils'

  // 使用正则表达式匹配Markdown代码块
  const codeBlockRegex = /(```[a-zA-Z]*\n[\s\S]*?\n```)/g
  const parts = content.split(codeBlockRegex)

  const processedParts = parts.map((part, index) => {
    // 如果是代码块(奇数索引),则原样返回
    if (index % 2 === 1) {
      return part
    }

    let result = part

    if (mode === 'remove') {
      // 移除各种形式的引用标记
      result = result
        .replace(/\[<sup[^>]*data-citation[^>]*>\d+<\/sup>\]\([^)]*\)/g, '')
        .replace(/\[<sup[^>]*>\d+<\/sup>\]\([^)]*\)/g, '')
        .replace(/<sup[^>]*data-citation[^>]*>\d+<\/sup>/g, '')
        .replace(/\[(\d+)\](?!\()/g, '')
    } else if (mode === 'normalize') {
      // 标准化引用格式为Markdown脚注格式
      result = result
        // 将 [<sup data-citation='...'>数字</sup>](链接) 转换为 [^数字]
        .replace(/\[<sup[^>]*data-citation[^>]*>(\d+)<\/sup>\]\([^)]*\)/g, '[^$1]')
        // 将 [<sup>数字</sup>](链接) 转换为 [^数字]
        .replace(/\[<sup[^>]*>(\d+)<\/sup>\]\([^)]*\)/g, '[^$1]')
        // 将独立的 <sup data-citation='...'>数字</sup> 转换为 [^数字]
        .replace(/<sup[^>]*data-citation[^>]*>(\d+)<\/sup>/g, '[^$1]')
        // 将 [数字] 转换为 [^数字]（但要小心不要转换其他方括号内容）
        .replace(/\[(\d+)\](?!\()/g, '[^$1]')
    }

    // 按行处理，保留Markdown结构
    const lines = result.split('\n')
    const processedLines = lines.map((line) => {
      // 如果是引用块或其他特殊格式，不要修改空格
      if (line.match(/^>|^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\s{4,}/)) {
        return line.replace(/[ ]+/g, ' ').replace(/[ ]+$/g, '')
      }
      // 普通文本行，清理多余空格但保留基本格式
      return line.replace(/[ ]+/g, ' ').trim()
    })

    return processedLines.join('\n')
  })

  return processedParts.join('').trim()
}

/**
 * 标准化引用内容为Markdown脚注格式
 * @param citations 引用列表
 * @returns Markdown脚注格式的引用内容
 */
const formatCitationsAsFootnotes = (citations: string): string => {
  if (!citations.trim()) return ''

  // 将引用列表转换为脚注格式
  const lines = citations.split('\n\n')
  const footnotes = lines.map((line) => {
    const match = line.match(/^\[(\d+)\]\s*(.+)/)
    if (match) {
      const [, num, content] = match
      return `[^${num}]: ${content}`
    }
    return line
  })

  return footnotes.join('\n\n')
}

const createBaseMarkdown = (
  message: Message,
  includeReasoning: boolean = false,
  excludeCitations: boolean = false,
  normalizeCitations: boolean = true
): { titleSection: string; reasoningSection: string; contentSection: string; citation: string } => {
  const { forceDollarMathInMarkdown } = store.getState().settings
  const roleText = getRoleText(message.role, message.model?.name, message.model?.provider)
  const titleSection = `## ${roleText}`
  let reasoningSection = ''

  if (includeReasoning) {
    let reasoningContent = getThinkingContent(message)
    if (reasoningContent) {
      if (reasoningContent.startsWith('<think>\n')) {
        reasoningContent = reasoningContent.substring(8)
      } else if (reasoningContent.startsWith('<think>')) {
        reasoningContent = reasoningContent.substring(7)
      }
      // 使用 DOMPurify 安全地处理思维链内容
      reasoningContent = sanitizeReasoningContent(reasoningContent)
      if (forceDollarMathInMarkdown) {
        reasoningContent = convertMathFormula(reasoningContent)
      }
      reasoningSection = `<div style="border: 2px solid #dddddd; border-radius: 10px;">
  <details style="padding: 5px;">
    <summary>${i18n.t('common.reasoning_content')}</summary>
    ${reasoningContent}
  </details>
</div>
`
    }
  }

  const content = getMainTextContent(message)
  let citation = excludeCitations ? '' : getCitationContent(message)

  let processedContent = forceDollarMathInMarkdown ? convertMathFormula(content) : content

  // 处理引用标记
  if (excludeCitations) {
    processedContent = processCitations(processedContent, 'remove')
  } else if (normalizeCitations) {
    processedContent = processCitations(processedContent, 'normalize')
    citation = formatCitationsAsFootnotes(citation)
  }

  return { titleSection, reasoningSection, contentSection: processedContent, citation }
}

export const messageToMarkdown = (message: Message, excludeCitations?: boolean): string => {
  const { excludeCitationsInExport, standardizeCitationsInExport } = store.getState().settings
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, contentSection, citation } = createBaseMarkdown(
    message,
    false,
    shouldExcludeCitations,
    standardizeCitationsInExport
  )
  return [titleSection, '', contentSection, citation].join('\n')
}

export const messageToMarkdownWithReasoning = (message: Message, excludeCitations?: boolean): string => {
  const { excludeCitationsInExport, standardizeCitationsInExport } = store.getState().settings
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, reasoningSection, contentSection, citation } = createBaseMarkdown(
    message,
    true,
    shouldExcludeCitations,
    standardizeCitationsInExport
  )
  return [titleSection, '', reasoningSection, contentSection, citation].join('\n')
}

export const messagesToMarkdown = (
  messages: Message[],
  exportReasoning?: boolean,
  excludeCitations?: boolean
): string => {
  return messages
    .map((message) =>
      exportReasoning
        ? messageToMarkdownWithReasoning(message, excludeCitations)
        : messageToMarkdown(message, excludeCitations)
    )
    .join('\n---\n')
}

const formatMessageAsPlainText = (message: Message): string => {
  const roleText = message.role === 'user' ? 'User:' : 'Assistant:'
  const content = getMainTextContent(message)
  const plainTextContent = markdownToPlainText(content).trim()
  return `${roleText}\n${plainTextContent}`
}

export const messageToPlainText = (message: Message): string => {
  const content = getMainTextContent(message)
  return markdownToPlainText(content).trim()
}

const messagesToPlainText = (messages: Message[]): string => {
  return messages.map(formatMessageAsPlainText).join('\n\n')
}

export const topicToMarkdown = async (
  topic: Topic,
  exportReasoning?: boolean,
  excludeCitations?: boolean
): Promise<string> => {
  const topicName = `# ${topic.name}`

  const messages = await fetchTopicMessages(topic.id)

  if (messages && messages.length > 0) {
    return topicName + '\n\n' + messagesToMarkdown(messages, exportReasoning, excludeCitations)
  }

  return topicName
}

export const topicToPlainText = async (topic: Topic): Promise<string> => {
  const topicName = markdownToPlainText(topic.name).trim()

  const topicMessages = await fetchTopicMessages(topic.id)

  if (topicMessages && topicMessages.length > 0) {
    return topicName + '\n\n' + messagesToPlainText(topicMessages)
  }

  return topicName
}

export const exportTopicAsMarkdown = async (
  topic: Topic,
  exportReasoning?: boolean,
  excludeCitations?: boolean
): Promise<void> => {
  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const fileName = removeSpecialCharactersForFileName(topic.name) + '.md'
      const markdown = await topicToMarkdown(topic, exportReasoning, excludeCitations)
      const result = await window.api.file.save(fileName, markdown)
      if (result) {
        window.toast.success(i18n.t('message.success.markdown.export.specified'))
      }
    } catch (error: any) {
      window.toast.error(i18n.t('message.error.markdown.export.specified'))
      logger.error('Failed to export topic as markdown:', error)
    } finally {
      setExportingState(false)
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const fileName = removeSpecialCharactersForFileName(topic.name) + ` ${timestamp}.md`
      const markdown = await topicToMarkdown(topic, exportReasoning, excludeCitations)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.toast.success(i18n.t('message.success.markdown.export.preconf'))
    } catch (error: any) {
      window.toast.error(i18n.t('message.error.markdown.export.preconf'))
      logger.error('Failed to export topic as markdown:', error)
    } finally {
      setExportingState(false)
    }
  }
}

export const exportMessageAsMarkdown = async (
  message: Message,
  exportReasoning?: boolean,
  excludeCitations?: boolean
): Promise<void> => {
  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + '.md'
      const markdown = exportReasoning
        ? messageToMarkdownWithReasoning(message, excludeCitations)
        : messageToMarkdown(message, excludeCitations)
      const result = await window.api.file.save(fileName, markdown)
      if (result) {
        window.toast.success(i18n.t('message.success.markdown.export.specified'))
      }
    } catch (error: any) {
      window.toast.error(i18n.t('message.error.markdown.export.specified'))
      logger.error('Failed to export message as markdown:', error)
    } finally {
      setExportingState(false)
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + ` ${timestamp}.md`
      const markdown = exportReasoning
        ? messageToMarkdownWithReasoning(message, excludeCitations)
        : messageToMarkdown(message, excludeCitations)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.toast.success(i18n.t('message.success.markdown.export.preconf'))
    } catch (error: any) {
      window.toast.error(i18n.t('message.error.markdown.export.preconf'))
      logger.error('Failed to export message as markdown:', error)
    } finally {
      setExportingState(false)
    }
  }
}

const convertMarkdownToNotionBlocks = async (markdown: string): Promise<any[]> => {