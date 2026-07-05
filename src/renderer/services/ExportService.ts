import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { Client } from '@notionhq/client'
// Known same-tier soft-edge (inherited from the former utils/export):
// `getTopicMessages` is a non-React data accessor that happens to live in the
// `useTopic` hook module, so this is a service -> hook import. Sinking the
// accessor below the hooks tier is deferred as out of scope here.
import { getTopicMessages } from '@renderer/hooks/useTopic'
import i18n from '@renderer/i18n'
import { getProviderLabelKey } from '@renderer/i18n/label'
import { addNote } from '@renderer/services/NotesService'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { Topic } from '@renderer/types/topic'
import { fetchMessagesSummary } from '@renderer/utils/aiGeneration'
import { getTitleFromString, messagesToPlainText, processCitations } from '@renderer/utils/export'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { captureScrollableAsBlob, captureScrollableAsDataUrl } from '@renderer/utils/image'
import { convertMathFormula, markdownToPlainText } from '@renderer/utils/markdown'
import { getComposerTextFromMessage } from '@renderer/utils/message/composerTokens'
import {
  getCitationContent,
  getMainTextContent,
  getNamingTextContent,
  getThinkingContent
} from '@renderer/utils/message/find'
import { markdownToBlocks } from '@tryfabric/martian'
import dayjs from 'dayjs'
import DOMPurify from 'dompurify'
import { appendBlocks } from 'notion-helper'

const logger = loggerService.withContext('ExportService')

// Single export-in-progress mutex shared by every exporter below
// (markdown / Notion / Yuque / Obsidian / Joplin / Siyuan): a second export
// started while one is still running is rejected with a warning toast. This
// mutable runtime state is what classifies the module as a `service` (runtime
// logic) rather than a pure `util`.
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
        const providerDisplayName = i18n.t(getProviderLabelKey(providerId), { defaultValue: providerId })
        assistantText += ` | ${providerDisplayName}`
        return assistantText
      }
      return assistantText
    } else if (showModelProviderInMarkdown && providerId) {
      const providerDisplayName = i18n.t(getProviderLabelKey(providerId), { defaultValue: providerId })
      assistantText += `Assistant | ${providerDisplayName}`
      return assistantText
    }
    return assistantText + 'Assistant'
  }
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
  message: ExportableMessage,
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

  const content = getComposerTextFromMessage(message, getMainTextContent(message))
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

export async function getMessageTitle(message: ExportableMessage, length = 30): Promise<string> {
  const content = getNamingTextContent(message)

  // Read from v2 Preference (`data.export.markdown.use_topic_naming_for_message_title`)
  // — the v1 Redux key was migrated; the renderer settings page reads the same
  // Preference key, so a stale read here would diverge from the settings UI value.
  const useTopicNaming = await preferenceService.get('data.export.markdown.use_topic_naming_for_message_title')
  if (useTopicNaming) {
    try {
      const titlePromise = fetchMessagesSummary({ messages: [message] })
      window.toast.loading({ title: i18n.t('chat.topics.export.wait_for_title_naming'), promise: titlePromise })
      const { text: title } = await titlePromise

      if (title) {
        window.toast.success(i18n.t('chat.topics.export.title_naming_success'))
        return title
      }
    } catch (e) {
      window.toast.error(i18n.t('chat.topics.export.title_naming_failed'))
      logger.error('Failed to generate title using topic naming, downgraded to default logic', e as Error)
    }
  }

  let title = getTitleFromString(content, length)

  if (!title) {
    title = dayjs(message.createdAt).format('YYYYMMDDHHmm')
  }

  return title
}

export const messageToMarkdown = async (message: ExportableMessage, excludeCitations?: boolean): Promise<string> => {
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

export const messageToMarkdownWithReasoning = async (
  message: ExportableMessage,
  excludeCitations?: boolean
): Promise<string> => {
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
  messages: ExportableMessage[],
  exportReasoning?: boolean,
  excludeCitations?: boolean
): Promise<string> => {
  const converter = exportReasoning ? messageToMarkdownWithReasoning : messageToMarkdown
  const markdowns = await Promise.all(messages.map((message) => converter(message, excludeCitations)))
  return markdowns.join('\n---\n')
}

export const topicToMarkdown = async (
  topic: Topic,
  exportReasoning?: boolean,
  excludeCitations?: boolean
): Promise<string> => {
  const topicName = `# ${topic.name}`

  const messages = await getTopicMessages(topic.id)

  if (messages && messages.length > 0) {
    return topicName + '\n\n' + (await messagesToMarkdown(messages, exportReasoning, excludeCitations))
  }

  return topicName
}

export const topicToPlainText = async (topic: Topic): Promise<string> => {
  const topicName = markdownToPlainText(topic.name).trim()

  const topicMessages = await getTopicMessages(topic.id)

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
  message: ExportableMessage,
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

export const exportMessageToNotion = async (
  title: string,
  content: string,
  message?: ExportableMessage
): Promise<boolean> => {
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

  const topicMessages = await getTopicMessages(topic.id)

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
  contentOrMessages: string | ExportableMessage | ExportableMessage[]
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

const saveContentToNotes = async (title: string, content: string, folderPath: string): Promise<void> => {
  await addNote(title, content, folderPath)

  window.toast.success(i18n.t('message.success.notes.export'))
}

const handleNotesExportError = (error: unknown): void => {
  logger.error('导出到笔记失败:', error as Error)
  window.toast.error(i18n.t('message.error.notes.export'))
}

/**
 * 导出任意文本内容到笔记工作区
 * @param title 笔记标题
 * @param content 笔记内容
 * @param folderPath 目标笔记文件夹
 */
export const exportContentToNotes = async (title: string, content: string, folderPath: string): Promise<void> => {
  try {
    await saveContentToNotes(title, content, folderPath)
  } catch (error) {
    handleNotesExportError(error)
    throw error
  }
}

/**
 * 导出消息到笔记工作区
 * @param title
 * @param content
 * @param folderPath
 */
export const exportMessageToNotes = async (title: string, content: string, folderPath: string): Promise<void> => {
  const cleanedContent = content.replace(/^## 🤖 Assistant(\n|$)/m, '')
  await exportContentToNotes(title, cleanedContent, folderPath)
}

/**
 * 导出话题到笔记工作区
 * @param topic 要导出的话题
 * @param folderPath
 */
export const exportTopicToNotes = async (topic: Topic, folderPath: string): Promise<void> => {
  try {
    const content = await topicToMarkdown(topic)
    await saveContentToNotes(topic.name, content, folderPath)
  } catch (error) {
    handleNotesExportError(error)
    throw error
  }
}

// NOTE (domain-axis follow-up, deferred per the cycle-break refactor plan):
// the note-export helpers from here down (`exportNoteAsMarkdown`, the
// `getScrollable*` accessors, the image-capture helpers, and the `exportNote`
// dispatcher) are notes-domain-specific — `getScrollableElement` even reaches
// into the `#notes-page` DOM of the notes page. They sit in this shared,
// cross-domain service only because notes has no `features/notes/` home yet;
// once it earns one, this cluster should move into the notes feature. Out of
// scope for breaking the MessagesService <-> utils/export cycle.
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

  const dataUrl = await captureScrollableAsDataUrl(scrollableRef)
  if (dataUrl) {
    const fileName = removeSpecialCharactersForFileName(noteName)
    await window.api.file.saveImage(fileName, dataUrl)
  }
}

interface NoteExportOptions {
  node: { name: string; externalPath: string }
  platform: 'markdown' | 'docx' | 'notion' | 'yuque' | 'joplin' | 'siyuan' | 'copyImage' | 'exportImage'
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
