import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { Client } from '@notionhq/client'
import i18n from '@renderer/i18n'
import { getProviderLabel } from '@renderer/i18n/label'
import { getMessageTitle } from '@renderer/services/MessagesService'
import { addNote } from '@renderer/services/NotesService'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { captureScrollableAsBlob, captureScrollableAsDataURL } from '@renderer/utils/image'
import { convertMathFormula, markdownToPlainText } from '@renderer/utils/markdown'
import { markdownToHtml } from '@renderer/utils/markdownConverter'
import { getCitationContent, getMainTextContent, getThinkingContent } from '@renderer/utils/messageUtils/find'
import { markdownToBlocks } from '@tryfabric/martian'
import dayjs from 'dayjs'
import DOMPurify from 'dompurify'
import { appendBlocks } from 'notion-helper'

const logger = loggerService.withContext('Utils:export')

let exportState = false

const getExportState = () => exportState
const setExportingState = (isExporting: boolean) => {
  exportState = isExporting
}

/**
 * 安全地处理思维链内容，保留安全的 HTML 标签如 <br>，移除危险内容
 *
 * 支持的标签：
 * - 结构：br, p, div, span, h1-h6, blockquote
 * - 格式：strong, b, em, i, u, s, del, mark, small, sup, sub
 * - 列表：ul, ol, li
 * - 代码：code, pre, kbd, var, samp
 * - 表格：table, thead, tbody, tfoot, tr, td, th
 *
 * @param content 原始思维链内容
 * @returns 安全处理后的内容
 */
const sanitizeReasoningContent = (content: string): string => {
  // 先处理换行符转换为 <br>
  const contentWithBr = content.replace(/\n/g, '<br>')

  // 使用 DOMPurify 清理内容，保留常用的安全标签和属性
  return DOMPurify.sanitize(contentWithBr, {
    ALLOWED_TAGS: [
      // 换行和基础结构
      'br',
      'p',
      'div',
      'span',
      // 文本格式化
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'mark',
      'small',
      // 上标下标（数学公式、引用等）
      'sup',
      'sub',
      // 标题
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      // 引用
      'blockquote',
      // 列表
      'ul',
      'ol',
      'li',
      // 代码相关
      'code',
      'pre',
      'kbd',
      'var',
      'samp',
      // 表格（AI输出中可能包含表格）
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      // 分隔线
      'hr'
    ],
    ALLOWED_ATTR: [
      // 安全的通用属性
      'class',
      'title',
      'lang',
      'dir',
      // code 标签的语言属性
      'data-language',
      // 表格属性
      'colspan',
      'rowspan',
      // 列表属性
      'start',
      'type'
    ],
    KEEP_CONTENT: true, // 保留被移除标签的文本内容
    RETURN_DOM: false,
    SANITIZE_DOM: true,
    // 允许的协议（预留，虽然目前没有允许链接标签）
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  })
}

/**
 * 获取话题的消息列表，使用TopicManager确保消息被正确加载
 * 这样可以避免从未打开过的话题导出为空的问题
 * @param topicId 话题ID
 * @returns 话题消息列表
 */
async function fetchTopicMessages(topicId: string): Promise<Message[]> {
  const { TopicManager } = await import('@renderer/hooks/useTopic')
  return await TopicManager.getTopicMessages(topicId)
}

/**
 * 从消息内容中提取标题，限制长度并处理换行和标点符号。用于导出功能。
 * @param {string} str 输入字符串
 * @param {number} [length=80] 标题最大长度，默认为 80
 * @returns {string} 提取的标题
 */
export function getTitleFromString(str: string, length: number = 80): string {
  let title = str.trimStart().split('\n')[0]

  if (title.includes('。')) {
    title = title.split('。')[0]
  } else if (title.includes('，')) {
    title = title.split('，')[0]
  } else if (title.includes('.')) {
    title = title.split('.')[0]
  } else if (title.includes(',')) {
    title = title.split(',')[0]
  }

  if (title.length > length) {
    title = title.slice(0, length)
  }

  if (!title) {
    title = str.slice(0, length)
  }

  return title
}

const getRoleText = async (role: string, modelName?: string, providerId?: string): Promise<string> => {
  const { showModelNameInMarkdown, showModelProviderInMarkdown } = await preferenceService.getMultiple({
    showModelNameInMarkdown: 'data.export.markdown.show_model_name',
    showModelProviderInMarkdown: 'data.export.markdown.show_model_provider'
  })
  if (role === 'user') {
    return '🧑‍💻 User'
  } else if (role === 'system') {
    return '🤖 System'
  } else {
    let assistantText = '🤖 '
    if (showModelNameInMarkdown && modelName) {
      assistantText += `${modelName}`
      if (showModelProviderInMarkdown && providerId) {
        const providerDisplayName = getProviderLabel(providerId) ?? providerId
        assistantText += ` | ${providerDisplayName}`
        return assistantText
      }
      return assistantText
    } else if (showModelProviderInMarkdown && providerId) {
      const providerDisplayName = getProviderLabel(providerId) ?? providerId
      assistantText += `Assistant | ${providerDisplayName}`
      return assistantText
    }
    return assistantText + 'Assistant'
  }
}

/**
 * 处理文本中的引用标记
 * @param content 原始文本内容
 * @param mode 处理模式：'remove' 移除引用，'normalize' 标准化为Markdown格式
 * @returns 处理后的文本
 */
export const processCitations = (content: string, mode: 'remove' | 'normalize' = 'remove'): string => {
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

const createBaseMarkdown = async (
  message: Message,
  includeReasoning: boolean = false,
  excludeCitations: boolean = false,
  normalizeCitations: boolean = true
): Promise<{ titleSection: string; reasoningSection: string; contentSection: string; citation: string }> => {
  const forceDollarMathInMarkdown = await preferenceService.get('data.export.markdown.force_dollar_math')
  const roleText = await getRoleText(message.role, message.model?.name, message.model?.provider)
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

export const messageToMarkdown = async (message: Message, excludeCitations?: boolean): Promise<string> => {
  const { excludeCitationsInExport, standardizeCitationsInExport } = await preferenceService.getMultiple({
    excludeCitationsInExport: 'data.export.markdown.exclude_citations',
    standardizeCitationsInExport: 'data.export.markdown.standardize_citations'
  })
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, contentSection, citation } = await createBaseMarkdown(
    message,
    false,
    shouldExcludeCitations,
    standardizeCitationsInExport
  )
  return [titleSection, '', contentSection, citation].join('\n')
}

export const messageToMarkdownWithReasoning = async (message: Message, excludeCitations?: boolean): Promise<string> => {
  const { excludeCitationsInExport, standardizeCitationsInExport } = await preferenceService.getMultiple({
    excludeCitationsInExport: 'data.export.markdown.exclude_citations',
    standardizeCitationsInExport: 'data.export.markdown.standardize_citations'
  })
  const shouldExcludeCitations = excludeCitations ?? excludeCitationsInExport
  const { titleSection, reasoningSection, contentSection, citation } = await createBaseMarkdown(
    message,
    true,
    shouldExcludeCitations,
    standardizeCitationsInExport
  )
  return [titleSection, '', reasoningSection, contentSection, citation].join('\n')
}

export const messagesToMarkdown = async (
  messages: Message[],
  exportReasoning?: boolean,
  excludeCitations?: boolean
): Promise<string> => {
  const converter = exportReasoning ? messageToMarkdownWithReasoning : messageToMarkdown
  const markdowns = await Promise.all(messages.map((message) => converter(message, excludeCitations)))
  return markdowns.join('\n---\n')
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
    return topicName + '\n\n' + (await messagesToMarkdown(messages, exportReasoning, excludeCitations))
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

  const markdownExportPath = await preferenceService.get('data.export.markdown.path')
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

  const markdownExportPath = await preferenceService.get('data.export.markdown.path')
  if (!markdownExportPath) {
    try {
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + '.md'
      const markdown = exportReasoning
        ? await messageToMarkdownWithReasoning(message, excludeCitations)
        : await messageToMarkdown(message, excludeCitations)
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
        ? await messageToMarkdownWithReasoning(message, excludeCitations)
        : await messageToMarkdown(message, excludeCitations)
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
  return markdownToBlocks(markdown)
}

const convertThinkingToNotionBlocks = async (thinkingContent: string): Promise<any[]> => {
  if (!thinkingContent.trim()) {
    return []
  }

  try {
    // 预处理思维链内容：将HTML的<br>标签转换为真正的换行符
    const processedContent = thinkingContent.replace(/<br\s*\/?>/g, '\n')

    // 使用 markdownToBlocks 处理思维链内容
    const childrenBlocks = markdownToBlocks(processedContent)

    return [
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: '🤔 ' + i18n.t('common.reasoning_content')
              },
              annotations: {
                bold: true
              }
            }
          ],
          children: childrenBlocks
        }
      }
    ]
  } catch (error) {
    logger.error('failed to process reasoning content:', error as Error)
    // 发生错误时，回退到简单的段落处理
    return [
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: '🤔 ' + i18n.t('common.reasoning_content')
              },
              annotations: {
                bold: true
              }
            }
          ],
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: {
                      content:
                        thinkingContent.length > 1800
                          ? thinkingContent.substring(0, 1800) + '...\n' + i18n.t('export.notion.reasoning_truncated')
                          : thinkingContent
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}

const executeNotionExport = async (title: string, allBlocks: any[]): Promise<boolean> => {
  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return false
  }

  const { notionDatabaseID, notionApiKey, notionPageNameKey } = await preferenceService.getMultiple({
    notionDatabaseID: 'data.integration.notion.database_id',
    notionPageNameKey: 'data.integration.notion.page_name_key',
    notionApiKey: 'data.integration.notion.api_key'
  })
  if (!notionApiKey || !notionDatabaseID) {
    window.toast.error(i18n.t('message.error.notion.no_api_key'))
    return false
  }

  if (allBlocks.length === 0) {
    window.toast.error(i18n.t('message.error.notion.export'))
    return false
  }

  setExportingState(true)

  // 限制标题长度
  if (title.length > 32) {
    title = title.slice(0, 29) + '...'
  }

  try {
    const notion = new Client({ auth: notionApiKey })

    const responsePromise = notion.pages.create({
      parent: { database_id: notionDatabaseID },
      properties: {
        [notionPageNameKey || 'Name']: {
          title: [{ text: { content: title } }]
        }
      }
    })
    window.toast.loading({ title: i18n.t('message.loading.notion.preparing'), promise: responsePromise })
    const response = await responsePromise

    const exportPromise = appendBlocks({
      block_id: response.id,
      children: allBlocks,
      client: notion
    })
    window.toast.loading({ title: i18n.t('message.loading.notion.exporting_progress'), promise: exportPromise })

    window.toast.success(i18n.t('message.success.notion.export'))
    return true
  } catch (error: any) {
    // 清理可能存在的loading消息

    logger.error('Notion export failed:', error)
    window.toast.error(i18n.t('message.error.notion.export'))
    return false
  } finally {
    setExportingState(false)
  }
}

export const exportMessageToNotion = async (title: string, content: string, message?: Message): Promise<boolean> => {
  const notionExportReasoning = await preferenceService.get('data.integration.notion.export_reasoning')

  const notionBlocks = await convertMarkdownToNotionBlocks(content)

  if (notionExportReasoning && message) {
    const thinkingContent = getThinkingContent(message)
    if (thinkingContent) {
      const thinkingBlocks = await convertThinkingToNotionBlocks(thinkingContent)
      if (notionBlocks.length > 0) {
        notionBlocks.splice(1, 0, ...thinkingBlocks)
      } else {
        notionBlocks.push(...thinkingBlocks)
      }
    }
  }

  return executeNotionExport(title, notionBlocks)
}

export const exportTopicToNotion = async (topic: Topic): Promise<boolean> => {
  const { notionExportReasoning, excludeCitationsInExport } = await preferenceService.getMultiple({
    notionExportReasoning: 'data.integration.notion.export_reasoning',
    excludeCitationsInExport: 'data.export.markdown.exclude_citations'
  })

  const topicMessages = await fetchTopicMessages(topic.id)

  // 创建话题标题块
  const titleBlocks = await convertMarkdownToNotionBlocks(`# ${topic.name}`)

  // 为每个消息创建blocks
  const allBlocks: any[] = [...titleBlocks]

  for (const message of topicMessages) {
    // 将单个消息转换为markdown
    const messageMarkdown = await messageToMarkdown(message, excludeCitationsInExport)
    const messageBlocks = await convertMarkdownToNotionBlocks(messageMarkdown)

    if (notionExportReasoning) {
      const thinkingContent = getThinkingContent(message)
      if (thinkingContent) {
        const thinkingBlocks = await convertThinkingToNotionBlocks(thinkingContent)
        if (messageBlocks.length > 0) {
          messageBlocks.splice(1, 0, ...thinkingBlocks)
        } else {
          messageBlocks.push(...thinkingBlocks)
        }
      }
    }

    allBlocks.push(...messageBlocks)
  }

  return executeNotionExport(topic.name, allBlocks)
}

export const exportMarkdownToYuque = async (title: string, content: string): Promise<any | null> => {
  const { yuqueToken, yuqueRepoId } = await preferenceService.getMultiple({
    yuqueToken: 'data.integration.yuque.token',
    yuqueRepoId: 'data.integration.yuque.repo_id'
  })

  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  if (!yuqueToken || !yuqueRepoId) {
    window.toast.error(i18n.t('message.error.yuque.no_config'))
    return
  }

  setExportingState(true)

  try {
    const response = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueRepoId}/docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': yuqueToken,
        'User-Agent': 'CherryAI'
      },
      body: JSON.stringify({
        title: title,
        slug: Date.now().toString(), // 使用时间戳作为唯一slug
        format: 'markdown',
        body: content
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    const doc_id = data.data.id

    const tocResponse = await fetch(`https://www.yuque.com/api/v2/repos/${yuqueRepoId}/toc`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': yuqueToken,
        'User-Agent': 'CherryAI'
      },
      body: JSON.stringify({
        action: 'appendNode',
        action_mode: 'sibling',
        doc_ids: [doc_id]
      })
    })

    if (!tocResponse.ok) {
      throw new Error(`HTTP error! status: ${tocResponse.status}`)
    }

    window.toast.success(i18n.t('message.success.yuque.export'))
    return data
  } catch (error: any) {
    logger.debug(error)
    window.toast.error(i18n.t('message.error.yuque.export'))
    return null
  } finally {
    setExportingState(false)
  }
}

/**
 * 导出Markdown到Obsidian
 * @param attributes 文档属性
 * @param attributes.title 标题
 * @param attributes.created 创建时间
 * @param attributes.source 来源
 * @param attributes.tags 标签
 * @param attributes.processingMethod 处理方式
 * @param attributes.folder 选择的文件夹路径或文件路径
 * @param attributes.vault 选择的Vault名称
 */
export const exportMarkdownToObsidian = async (attributes: any): Promise<void> => {
  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  try {
    // 从参数获取Vault名称
    const obsidianVault = attributes.vault
    let obsidianFolder = attributes.folder || ''
    let isMarkdownFile = false

    if (!obsidianVault) {
      window.toast.error(i18n.t('chat.topics.export.obsidian_no_vault_selected'))
      return
    }

    if (!attributes.title) {
      window.toast.error(i18n.t('chat.topics.export.obsidian_title_required'))
      return
    }

    // 检查是否选择了.md文件
    if (obsidianFolder && obsidianFolder.endsWith('.md')) {
      isMarkdownFile = true
    }

    let filePath = ''

    // 如果是.md文件，直接使用该文件路径
    if (isMarkdownFile) {
      filePath = obsidianFolder
    } else {
      // 否则构建路径
      //构建保存路径添加以 / 结尾
      if (obsidianFolder && !obsidianFolder.endsWith('/')) {
        obsidianFolder = obsidianFolder + '/'
      }

      //构建文件名
      const fileName = transformObsidianFileName(attributes.title)
      filePath = obsidianFolder + fileName + '.md'
    }

    let obsidianUrl = `obsidian://new?file=${encodeURIComponent(filePath)}&vault=${encodeURIComponent(obsidianVault)}&clipboard`

    if (attributes.processingMethod === '3') {
      obsidianUrl += '&overwrite=true'
    } else if (attributes.processingMethod === '2') {
      obsidianUrl += '&prepend=true'
    } else if (attributes.processingMethod === '1') {
      obsidianUrl += '&append=true'
    }

    window.open(obsidianUrl)
    window.toast.success(i18n.t('chat.topics.export.obsidian_export_success'))
  } catch (error) {
    logger.error('Failed to export to Obsidian:', error as Error)
    window.toast.error(i18n.t('chat.topics.export.obsidian_export_failed'))
  } finally {
    setExportingState(false)
  }
}

/**
 * 生成Obsidian文件名,源自 Obsidian  Web Clipper 官方实现,修改了一些细节
 * @param fileName
 * @returns
 */
function transformObsidianFileName(fileName: string): string {
  const platform = window.navigator.userAgent
  const isWin = /win/i.test(platform)
  const isMac = /mac/i.test(platform)

  // 删除Obsidian 全平台无效字符
  let sanitized = fileName.replace(/[#|\\^\\[\]]/g, '')

  if (isWin) {
    // Windows 的清理
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '_$1$2') // 避免保留名称
      .replace(/[\s.]+$/, '') // 移除结尾的空格和句点
  } else if (isMac) {
    // Mac 的清理
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^\./, '_') // 避免以句点开头
  } else {
    // Linux 或其他系统
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^\./, '_') // 避免以句点开头
  }

  // 所有平台的通用操作
  sanitized = sanitized
    .replace(/^\.+/, '') // 移除开头的句点
    .trim() // 移除前后空格
    .slice(0, 245) // 截断为 245 个字符，留出空间以追加 ' 1.md'

  // 确保文件名不为空
  if (sanitized.length === 0) {
    sanitized = 'Untitled'
  }

  return sanitized
}

export const exportMarkdownToJoplin = async (
  title: string,
  contentOrMessages: string | Message | Message[]
): Promise<any | null> => {
  const { joplinUrl, joplinToken, joplinExportReasoning, excludeCitationsInExport } =
    await preferenceService.getMultiple({
      joplinUrl: 'data.integration.joplin.url',
      joplinToken: 'data.integration.joplin.token',
      joplinExportReasoning: 'data.integration.joplin.export_reasoning',
      excludeCitationsInExport: 'data.export.markdown.exclude_citations'
    })

  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  if (!joplinUrl || !joplinToken) {
    window.toast.error(i18n.t('message.error.joplin.no_config'))
    return
  }

  setExportingState(true)

  let content: string
  if (typeof contentOrMessages === 'string') {
    content = contentOrMessages
  } else if (Array.isArray(contentOrMessages)) {
    content = await messagesToMarkdown(contentOrMessages, joplinExportReasoning, excludeCitationsInExport)
  } else {
    // 单条Message
    content = joplinExportReasoning
      ? await messageToMarkdownWithReasoning(contentOrMessages, excludeCitationsInExport)
      : await messageToMarkdown(contentOrMessages, excludeCitationsInExport)
  }

  try {
    const baseUrl = joplinUrl.endsWith('/') ? joplinUrl : `${joplinUrl}/`
    const response = await fetch(`${baseUrl}notes?token=${joplinToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: title,
        body: content,
        source: 'Cherry Studio'
      })
    })

    if (!response.ok) {
      throw new Error('service not available')
    }

    const data = await response.json()
    if (data?.error) {
      throw new Error('response error')
    }

    window.toast.success(i18n.t('message.success.joplin.export'))
    return data
  } catch (error: any) {
    logger.error('Failed to export to Joplin:', error)
    window.toast.error(i18n.t('message.error.joplin.export'))
    return null
  } finally {
    setExportingState(false)
  }
}

/**
 * 导出Markdown到思源笔记
 * @param title 笔记标题
 * @param content 笔记内容
 */
export const exportMarkdownToSiyuan = async (title: string, content: string): Promise<void> => {
  const { siyuanApiUrl, siyuanToken, siyuanBoxId, siyuanRootPath } = await preferenceService.getMultiple({
    siyuanApiUrl: 'data.integration.siyuan.api_url',
    siyuanToken: 'data.integration.siyuan.token',
    siyuanBoxId: 'data.integration.siyuan.box_id',
    siyuanRootPath: 'data.integration.siyuan.root_path'
  })

  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  if (!siyuanApiUrl || !siyuanToken || !siyuanBoxId) {
    window.toast.error(i18n.t('message.error.siyuan.no_config'))
    return
  }

  setExportingState(true)

  try {
    // test connection
    const testResponse = await fetch(`${siyuanApiUrl}/api/notebook/lsNotebooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${siyuanToken}`
      }
    })

    if (!testResponse.ok) {
      throw new Error('API请求失败')
    }

    const testData = await testResponse.json()
    if (testData.code !== 0) {
      throw new Error(`${testData.msg || i18n.t('message.error.unknown')}`)
    }

    // 确保根路径以/开头
    const rootPath = siyuanRootPath?.startsWith('/') ? siyuanRootPath : `/${siyuanRootPath || 'CherryStudio'}`
    const renderedRootPath = await renderSprigTemplate(siyuanApiUrl, siyuanToken, rootPath)
    // 创建文档
    const docTitle = `${title.replace(/[#|\\^\\[\]]/g, '')}`
    const docPath = `${renderedRootPath}/${docTitle}`

    // 创建文档
    await createSiyuanDoc(siyuanApiUrl, siyuanToken, siyuanBoxId, docPath, content)

    window.toast.success(i18n.t('message.success.siyuan.export'))
  } catch (error) {
    logger.error('Failed to export to Siyuan:', error as Error)
    window.toast.error(i18n.t('message.error.siyuan.export') + (error instanceof Error ? `: ${error.message}` : ''))
  } finally {
    setExportingState(false)
  }
}
/**
 * 渲染 思源笔记 Sprig 模板字符串
 * @param apiUrl 思源 API 地址
 * @param token 思源 API Token
 * @param template Sprig 模板
 * @returns 渲染后的字符串
 */
async function renderSprigTemplate(apiUrl: string, token: string, template: string): Promise<string> {
  const response = await fetch(`${apiUrl}/api/template/renderSprig`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`
    },
    body: JSON.stringify({ template })
  })

  const data = await response.json()
  if (data.code !== 0) {
    throw new Error(`${data.msg || i18n.t('message.error.unknown')}`)
  }

  return data.data
}

/**
 * 创建思源笔记文档
 */
async function createSiyuanDoc(
  apiUrl: string,
  token: string,
  boxId: string,
  path: string,
  markdown: string
): Promise<string> {
  const response = await fetch(`${apiUrl}/api/filetree/createDocWithMd`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token ${token}`
    },
    body: JSON.stringify({
      notebook: boxId,
      path: path,
      markdown: markdown
    })
  })

  const data = await response.json()
  if (data.code !== 0) {
    throw new Error(`${data.msg || i18n.t('message.error.unknown')}`)
  }

  return data.data
}

/**
 * 导出消息到笔记工作区
 * @returns 创建的笔记节点
 * @param title
 * @param content
 * @param folderPath
 */
export const exportMessageToNotes = async (title: string, content: string, folderPath: string): Promise<void> => {
  try {
    const cleanedContent = content.replace(/^## 🤖 Assistant(\n|$)/m, '')
    await addNote(title, cleanedContent, folderPath)

    window.toast.success(i18n.t('message.success.notes.export'))
  } catch (error) {
    logger.error('导出到笔记失败:', error as Error)
    window.toast.error(i18n.t('message.error.notes.export'))
    throw error
  }
}

/**
 * 导出话题到笔记工作区
 * @param topic 要导出的话题
 * @param folderPath
 * @returns 创建的笔记节点
 */
export const exportTopicToNotes = async (topic: Topic, folderPath: string): Promise<void> => {
  try {
    const content = await topicToMarkdown(topic)
    await addNote(topic.name, content, folderPath)

    window.toast.success(i18n.t('message.success.notes.export'))
  } catch (error) {
    logger.error('导出到笔记失败:', error as Error)
    window.toast.error(i18n.t('message.error.notes.export'))
    throw error
  }
}

const exportNoteAsMarkdown = async (noteName: string, content: string): Promise<void> => {
  const markdown = `# ${noteName}\n\n${content}`
  const fileName = removeSpecialCharactersForFileName(noteName) + '.md'
  const result = await window.api.file.save(fileName, markdown)
  if (result) {
    window.toast.success(i18n.t('message.success.markdown.export.specified'))
  }
}

const getScrollableElement = (): HTMLElement | null => {
  const notesPage = document.querySelector('#notes-page')
  if (!notesPage) return null

  const allDivs = notesPage.querySelectorAll('div')
  for (const div of Array.from(allDivs)) {
    const style = window.getComputedStyle(div)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      if (div.querySelector('.ProseMirror')) {
        return div as HTMLElement
      }
    }
  }
  return null
}

const getScrollableRef = (): { current: HTMLElement } | null => {
  const element = getScrollableElement()
  if (!element) {
    window.toast.warning(i18n.t('notes.no_content_to_copy'))
    return null
  }
  return { current: element }
}

const exportNoteAsImageToClipboard = async (): Promise<void> => {
  const scrollableRef = getScrollableRef()
  if (!scrollableRef) return

  await captureScrollableAsBlob(scrollableRef, async (blob) => {
    if (blob) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      window.toast.success(i18n.t('common.copied'))
    }
  })
}

const exportNoteAsImageFile = async (noteName: string): Promise<void> => {
  const scrollableRef = getScrollableRef()
  if (!scrollableRef) return

  const dataUrl = await captureScrollableAsDataURL(scrollableRef)
  if (dataUrl) {
    const fileName = removeSpecialCharactersForFileName(noteName)
    await window.api.file.saveImage(fileName, dataUrl)
  }
}

interface NoteExportOptions {
  node: { name: string; externalPath: string }
  platform: 'markdown' | 'docx' | 'notion' | 'yuque' | 'obsidian' | 'joplin' | 'siyuan' | 'copyImage' | 'exportImage'
}

export const exportNote = async ({ node, platform }: NoteExportOptions): Promise<void> => {
  try {
    const content = await window.api.file.readExternal(node.externalPath)

    switch (platform) {
      case 'copyImage':
        return await exportNoteAsImageToClipboard()
      case 'exportImage':
        return await exportNoteAsImageFile(node.name)
      case 'markdown':
        return await exportNoteAsMarkdown(node.name, content)
      case 'docx':
        void window.api.export.toWord(`# ${node.name}\n\n${content}`, removeSpecialCharactersForFileName(node.name))
        return
      case 'notion':
        await exportMessageToNotion(node.name, content)
        return
      case 'yuque':
        await exportMarkdownToYuque(node.name, `# ${node.name}\n\n${content}`)
        return
      case 'obsidian': {
        const { default: ObsidianExportPopup } = await import('@renderer/components/Popups/ObsidianExportPopup')
        await ObsidianExportPopup.show({ title: node.name, processingMethod: '1', rawContent: content })
        return
      }
      case 'joplin':
        await exportMarkdownToJoplin(node.name, content)
        return
      case 'siyuan':
        await exportMarkdownToSiyuan(node.name, `# ${node.name}\n\n${content}`)
        return
    }
  } catch (error) {
    logger.error(`Failed to export note to ${platform}:`, error as Error)
    throw error
  }
}

// ============================================================================
// HTML Export Functions
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS.
 */
const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Build a self-contained HTML document around the rendered content.
 *
 * The HTML is fully self-contained with inline CSS — no external dependencies,
 * no CDN links. It supports light/dark mode via prefers-color-scheme,
 * responsive layout, and print styles.
 */
const buildHtmlDocument = (title: string, bodyHtml: string): string => {
  const dateStr = dayjs().format('YYYY-MM-DD HH:mm:ss')
  const escapedTitle = escapeHtml(title)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapedTitle} - Cherry Studio Export</title>
<style>
  :root {
    --color-bg: #ffffff;
    --color-text: #1f2328;
    --color-text-secondary: #656d76;
    --color-border: #d0d7de;
    --color-bg-muted: #f6f8fa;
    --color-bg-soft: #f3f4f6;
    --color-primary: #0969da;
    --color-link: #0969da;
    --color-code-bg: #f6f8fa;
    --color-blockquote-border: #0969da;
    --color-table-header-bg: #f6f8fa;
    --code-font: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace;
    --body-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-bg: #0d1117;
      --color-text: #e6edf3;
      --color-text-secondary: #8b949e;
      --color-border: #30363d;
      --color-bg-muted: #161b22;
      --color-bg-soft: #21262d;
      --color-primary: #58a6ff;
      --color-link: #58a6ff;
      --color-code-bg: #161b22;
      --color-blockquote-border: #58a6ff;
      --color-table-header-bg: #161b22;
    }
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--body-font);
    font-size: 16px;
    line-height: 1.6;
    color: var(--color-text);
    background: var(--color-bg);
    padding: 20px;
  }
  .container {
    max-width: 900px;
    margin: 0 auto;
  }
  header {
    padding-bottom: 24px;
    margin-bottom: 32px;
    border-bottom: 2px solid var(--color-border);
  }
  .topic-title {
    font-size: 2em;
    font-weight: 700;
    line-height: 1.3;
    margin-bottom: 8px;
    color: var(--color-text);
  }
  .export-meta {
    font-size: 0.85em;
    color: var(--color-text-secondary);
  }

  /* Markdown body styles */
  .markdown-body { word-break: break-word; }
  .markdown-body > *:first-child { margin-top: 0 !important; }
  .markdown-body h1, .markdown-body h2, .markdown-body h3,
  .markdown-body h4, .markdown-body h5, .markdown-body h6 {
    margin: 1.5em 0 0.75em 0;
    line-height: 1.3;
    font-weight: 700;
  }
  .markdown-body h1 { font-size: 2em; border-bottom: 1px solid var(--color-border); padding-bottom: 0.3em; }
  .markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid var(--color-border); padding-bottom: 0.3em; }
  .markdown-body h3 { font-size: 1.25em; }
  .markdown-body h4 { font-size: 1em; }
  .markdown-body h5 { font-size: 0.875em; }
  .markdown-body h6 { font-size: 0.85em; }

  .markdown-body p { margin: 1em 0; white-space: pre-wrap; }
  .markdown-body p:last-child { margin-bottom: 0.5em; }
  .markdown-body p:first-child { margin-top: 0; }

  .markdown-body ul { list-style: disc; }
  .markdown-body ol { list-style: decimal; }
  .markdown-body ul, .markdown-body ol { padding-left: 2em; margin: 1em 0; }
  .markdown-body li { margin-bottom: 0.35em; }
  .markdown-body li > ul, .markdown-body li > ol { margin: 0.5em 0; }

  .markdown-body hr {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 24px 0;
  }

  .markdown-body p code,
  .markdown-body li code {
    background: var(--color-code-bg);
    padding: 2px 6px;
    margin: 0 2px;
    border-radius: 4px;
    font-family: var(--code-font);
    font-size: 0.875em;
  }

  .markdown-body pre {
    background: var(--color-code-bg);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow-x: auto;
    margin: 1em 0;
    padding: 16px;
  }
  .markdown-body pre code {
    display: block;
    font-family: var(--code-font);
    font-size: 0.875em;
    line-height: 1.5;
    background: none;
    padding: 0;
    margin: 0;
    border-radius: 0;
  }

  .markdown-body blockquote {
    margin: 1em 0;
    padding: 0.75em 1em;
    background: var(--color-bg-soft);
    border-left: 4px solid var(--color-blockquote-border);
    border-radius: 0 6px 6px 0;
    color: var(--color-text-secondary);
  }
  .markdown-body blockquote > :first-child { margin-top: 0; }
  .markdown-body blockquote > :last-child { margin-bottom: 0; }

  .markdown-body table {
    margin: 1.5em 0;
    font-size: 0.9em;
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow: hidden;
  }
  .markdown-body th, .markdown-body td {
    border-right: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
    padding: 8px 12px;
    text-align: left;
  }
  .markdown-body th:last-child, .markdown-body td:last-child { border-right: none; }
  .markdown-body tr:last-child td { border-bottom: none; }
  .markdown-body th {
    background: var(--color-table-header-bg);
    font-weight: 600;
  }
  .markdown-body tr:nth-child(even) td { background: var(--color-bg-muted); }

  .markdown-body img { max-width: 100%; height: auto; margin: 1em 0; border-radius: 6px; }
  .markdown-body a { color: var(--color-link); text-decoration: none; }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body strong { font-weight: 700; }
  .markdown-body em { font-style: italic; }
  .markdown-body del { text-decoration: line-through; }
  .markdown-body sup { font-size: 0.75em; vertical-align: super; }
  .markdown-body sub { font-size: 0.75em; vertical-align: sub; }

  /* Task list */
  .markdown-body ul[data-type="taskList"] { list-style: none; padding-left: 0.5em; }
  .markdown-body li[data-type="taskItem"] { list-style: none; }
  .markdown-body li[data-type="taskItem"] input[type="checkbox"] {
    margin-right: 0.5em;
    vertical-align: middle;
  }
  .markdown-body li[data-type="taskItem"] label { cursor: default; }

  /* YAML front matter */
  .markdown-body [data-type="yamlFrontMatter"] {
    background: var(--color-bg-muted);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 1em;
    font-family: var(--code-font);
    font-size: 0.85em;
    white-space: pre-wrap;
  }

  /* Math blocks */
  .markdown-body [data-type="block-math"],
  .markdown-body .katex-block {
    text-align: center;
    margin: 1.5em 0;
    padding: 8px;
    overflow-x: auto;
  }

  /* Details/summary (reasoning blocks) */
  .markdown-body details {
    border: 2px solid var(--color-border);
    border-radius: 10px;
    padding: 8px 12px;
    margin: 1em 0;
  }
  .markdown-body details summary {
    cursor: pointer;
    font-weight: 600;
    padding: 4px 0;
  }

  /* Footnotes */
  .markdown-body .footnotes {
    margin-top: 2em;
    padding-top: 1em;
    border-top: 1px solid var(--color-border);
  }
  .markdown-body .footnotes ol { padding-left: 1.5em; }
  .markdown-body .footnotes li { font-size: 0.9em; color: var(--color-text-secondary); }

  @media print {
    body { color: #000; background: #fff; }
    .markdown-body pre { border: 1px solid #ccc; background: #f5f5f5; }
    .markdown-body a { color: #000; }
  }

  @media (max-width: 768px) {
    body { padding: 12px; font-size: 15px; }
    .container { max-width: 100%; }
    .topic-title { font-size: 1.5em; }
    .markdown-body table { display: block; overflow-x: auto; }
    .markdown-body pre { padding: 12px; }
  }
</style>
</head>
<body>
  <div class="container">
    <header>
      <h1 class="topic-title">${escapedTitle}</h1>
      <div class="export-meta">Exported from Cherry Studio on ${dateStr}</div>
    </header>
    <main class="markdown-body">
${bodyHtml}
    </main>
  </div>
</body>
</html>`
}

/**
 * Convert a topic (conversation) to a self-contained HTML document.
 *
 * @param topic - The topic to convert
 * @returns A complete HTML document string
 */
export const topicToHtml = async (topic: Topic): Promise<string> => {
  const messages = await fetchTopicMessages(topic.id)

  if (!messages || messages.length === 0) {
    return buildHtmlDocument(topic.name, '<p>(No messages in this conversation)</p>')
  }

  const markdown = await messagesToMarkdown(messages)
  const bodyHtml = markdownToHtml(markdown)
  return buildHtmlDocument(topic.name, bodyHtml)
}

/**
 * Convert a single message to a self-contained HTML document.
 *
 * @param message - The message to convert
 * @returns A complete HTML document string
 */
export const messageToHtml = async (message: Message): Promise<string> => {
  const title = await getMessageTitle(message)
  const markdown = await messageToMarkdown(message)
  const bodyHtml = markdownToHtml(markdown)
  return buildHtmlDocument(title, bodyHtml)
}

/**
 * Export a topic as a self-contained HTML file via native save dialog.
 *
 * @param topic - The topic to export
 */
export const exportTopicAsHtml = async (topic: Topic): Promise<void> => {
  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  try {
    const fileName = removeSpecialCharactersForFileName(topic.name) + '.html'
    const html = await topicToHtml(topic)
    const result = await window.api.file.save(fileName, html)
    if (result) {
      window.toast.success(i18n.t('message.success.html.export'))
    }
  } catch (error: any) {
    window.toast.error(i18n.t('message.error.html.export'))
    logger.error('Failed to export topic as HTML:', error)
  } finally {
    setExportingState(false)
  }
}

/**
 * Export a single message as a self-contained HTML file via native save dialog.
 *
 * @param message - The message to export
 */
export const exportMessageAsHtml = async (message: Message): Promise<void> => {
  if (getExportState()) {
    window.toast.warning(i18n.t('message.warn.export.exporting'))
    return
  }

  setExportingState(true)

  try {
    const title = await getMessageTitle(message)
    const fileName = removeSpecialCharactersForFileName(title) + '.html'
    const html = await messageToHtml(message)
    const result = await window.api.file.save(fileName, html)
    if (result) {
      window.toast.success(i18n.t('message.success.html.export'))
    }
  } catch (error: any) {
    window.toast.error(i18n.t('message.error.html.export'))
    logger.error('Failed to export message as HTML:', error)
  } finally {
    setExportingState(false)
  }
}
