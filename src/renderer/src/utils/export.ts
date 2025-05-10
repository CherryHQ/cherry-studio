import { Client } from '@notionhq/client'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { getMessageTitle } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { setExportState } from '@renderer/store/runtime'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { removeSpecialCharactersForFileName } from '@renderer/utils/file'
import { convertMathFormula } from '@renderer/utils/markdown'
import { getMainTextContent, getThinkingContent } from '@renderer/utils/messageUtils/find'
import { markdownToBlocks } from '@tryfabric/martian'
import dayjs from 'dayjs'
// TODO: OB、Joplin支持思维链导出

/**
 * 从消息内容中提取标题，限制长度并处理换行和标点符号。用于导出功能。
 * @param str 输入字符串
 * @param length 标题最大长度，默认为 80
 * @returns string 提取的标题
 */
export function getTitleFromString(str: string, length: number = 80) {
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

export const messageToMarkdown = (message: Message) => {
  const { forceDollarMathInMarkdown, showModelNameInMarkdown } = store.getState().settings
  const roleText =
    message.role === 'user'
      ? '🧑‍💻 User'
      : `🤖 Assistant${showModelNameInMarkdown && message.model ? ` (${message.model.name})` : ''}`
  const titleSection = `### ${roleText}`
  const content = getMainTextContent(message)
  const contentSection = forceDollarMathInMarkdown ? convertMathFormula(content) : content

  return [titleSection, '', contentSection].join('\n')
}

// 保留接口用于其它导出方法使用
export const messageToMarkdownWithReasoning = (message: Message) => {
  const { forceDollarMathInMarkdown, showModelNameInMarkdown } = store.getState().settings
  const roleText =
    message.role === 'user'
      ? '🧑‍💻 User'
      : `🤖 Assistant${showModelNameInMarkdown && message.model ? ` (${message.model.name})` : ''}`
  const titleSection = `### ${roleText}`
  let reasoningContent = getThinkingContent(message)
  // 处理思考内容
  let reasoningSection = ''
  if (reasoningContent) {
    // 移除开头的<think>标记和换行符，并将所有换行符替换为<br>
    if (reasoningContent.startsWith('<think>\n')) {
      reasoningContent = reasoningContent.substring(8)
    } else if (reasoningContent.startsWith('<think>')) {
      reasoningContent = reasoningContent.substring(7)
    }
    reasoningContent = reasoningContent.replace(/\n/g, '<br>')

    // 应用数学公式转换（如果启用）
    if (forceDollarMathInMarkdown) {
      reasoningContent = convertMathFormula(reasoningContent)
    }
    // 添加思考内容的Markdown格式
    reasoningSection = `<details style="background-color: #f5f5f5; padding: 5px; border-radius: 10px; margin-bottom: 10px;">
      <summary>${i18n.t('common.reasoning_content')}</summary><hr>
    ${reasoningContent}
</details>`
  }
  const content = getMainTextContent(message)

  const contentSection = forceDollarMathInMarkdown ? convertMathFormula(content) : content

  return [titleSection, '', reasoningSection + contentSection].join('\n')
}

export const messagesToMarkdown = (messages: Message[], exportReasoning?: boolean) => {
  return messages
    .map((message) => (exportReasoning ? messageToMarkdownWithReasoning(message) : messageToMarkdown(message)))
    .join('\n\n---\n\n')
}

export const topicToMarkdown = async (topic: Topic, exportReasoning?: boolean) => {
  const topicName = `# ${topic.name}`
  const topicMessages = await db.topics.get(topic.id)

  if (topicMessages) {
    return topicName + '\n\n' + messagesToMarkdown(topicMessages.messages, exportReasoning)
  }

  return ''
}

export const exportTopicAsMarkdown = async (topic: Topic, exportReasoning?: boolean) => {
  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const fileName = removeSpecialCharactersForFileName(topic.name) + '.md'
      const markdown = await topicToMarkdown(topic, exportReasoning)
      const result = await window.api.file.save(fileName, markdown)
      if (result) {
        window.message.success({
          content: i18n.t('message.success.markdown.export.specified'),
          key: 'markdown-success'
        })
      }
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.specified'), key: 'markdown-error' })
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const fileName = removeSpecialCharactersForFileName(topic.name) + ` ${timestamp}.md`
      const markdown = await topicToMarkdown(topic, exportReasoning)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.message.success({ content: i18n.t('message.success.markdown.export.preconf'), key: 'markdown-success' })
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.preconf'), key: 'markdown-error' })
    }
  }
}

export const exportMessageAsMarkdown = async (message: Message, exportReasoning?: boolean) => {
  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + '.md'
      const markdown = exportReasoning ? messageToMarkdownWithReasoning(message) : messageToMarkdown(message)
      const result = await window.api.file.save(fileName, markdown)
      if (result) {
        window.message.success({
          content: i18n.t('message.success.markdown.export.specified'),
          key: 'markdown-success'
        })
      }
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.specified'), key: 'markdown-error' })
    }
  } else {
    try {
      const timestamp = dayjs().format('YYYY-MM-DD-HH-mm-ss')
      const title = await getMessageTitle(message)
      const fileName = removeSpecialCharactersForFileName(title) + ` ${timestamp}.md`
      const markdown = exportReasoning ? messageToMarkdownWithReasoning(message) : messageToMarkdown(message)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.message.success({ content: i18n.t('message.success.markdown.export.preconf'), key: 'markdown-success' })
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.preconf'), key: 'markdown-error' })
    }
  }
}

// TODO：Notion支持思维链导出(尝试转换为折叠块)
// TODO：Notion导出自动分页优化

const convertMarkdownToNotionBlocks = async (markdown: string) => {
  return markdownToBlocks(markdown)
}

const splitNotionBlocks = (blocks: any[]) => {
  const { notionAutoSplit, notionSplitSize } = store.getState().settings

  // 如果未开启自动分页,返回单页
  if (!notionAutoSplit) {
    return [blocks]
  }

  const pages: any[][] = []
  let currentPage: any[] = []

  blocks.forEach((block) => {
    if (currentPage.length >= notionSplitSize) {
      window.message.info({ content: i18n.t('message.info.notion.block_reach_limit'), key: 'notion-block-reach-limit' })
      pages.push(currentPage)
      currentPage = []
    }
    currentPage.push(block)
  })

  if (currentPage.length > 0) {
    pages.push(currentPage)
  }

  return pages
}

export const exportTopicToNotion = async (topic: Topic) => {
  const { isExporting } = store.getState().runtime.export
  if (isExporting) {
    window.message.warning({ content: i18n.t('message.warn.notion.exporting'), key: 'notion-exporting' })
    return
  }
  setExportState({
    isExporting: true
  })
  const { notionDatabaseID, notionApiKey } = store.getState().settings
  if (!notionApiKey || !notionDatabaseID) {
    window.message.error({ content: i18n.t('message.error.notion.no_api_key'), key: 'notion-no-apikey-error' })
    return
  }

  try {
    const notion = new Client({ auth: notionApiKey })
    const markdown = await topicToMarkdown(topic)
    const allBlocks = await convertMarkdownToNotionBlocks(markdown)
    const blockPages = splitNotionBlocks(allBlocks)

    if (blockPages.length === 0) {
      throw new Error('No content to export')
    }

    // 创建主页面和子页面
    let mainPageResponse: any = null
    let parentBlockId: string | null = null
    for (let i = 0; i < blockPages.length; i++) {
      const pageTitle = topic.name
      const pageBlocks = blockPages[i]

      // 导出进度提示
      window.message.loading({
        content: i18n.t('message.loading.notion.exporting_progress', {
          current: i + 1,
          total: blockPages.length
        }),
        key: 'notion-export-progress'
      })

      if (i === 0) {
        const response = await notion.pages.create({
          parent: { database_id: notionDatabaseID },
          properties: {
            [store.getState().settings.notionPageNameKey || 'Name']: {
              title: [{ text: { content: pageTitle } }]
            }
          },
          children: pageBlocks
        })
        mainPageResponse = response
        parentBlockId = response.id
      } else {
        if (!parentBlockId) {
          throw new Error('Parent block ID is null')
        }
        await notion.blocks.children.append({
          block_id: parentBlockId,
          children: pageBlocks
        })
      }
    }

    window.message.success({ content: i18n.t('message.success.notion.export'), key: 'notion-export-progress' })
    return mainPageResponse
  } catch (error: any) {
    window.message.error({ content: i18n.t('message.error.notion.export'), key: 'notion-export-progress' })
    return null
  } finally {
    setExportState({
      isExporting: false
    })
  }
}

export const exportMarkdownToNotion = async (title: string, content: string) => {
  const { isExporting } = store.getState().runtime.export

  if (isExporting) {
    window.message.warning({ content: i18n.t('message.warn.notion.exporting'), key: 'notion-exporting' })
    return
  }

  setExportState({ isExporting: true })

  const { notionDatabaseID, notionApiKey } = store.getState().settings

  if (!notionApiKey || !notionDatabaseID) {
    window.message.error({ content: i18n.t('message.error.notion.no_api_key'), key: 'notion-no-apikey-error' })
    return
  }

  try {
    const notion = new Client({ auth: notionApiKey })
    const notionBlocks = await convertMarkdownToNotionBlocks(content)

    if (notionBlocks.length === 0) {
      throw new Error('No content to export')
    }

    const response = await notion.pages.create({
      parent: { database_id: notionDatabaseID },
      properties: {
        [store.getState().settings.notionPageNameKey || 'Name']: {
          title: [{ text: { content: title } }]
        }
      },
      children: notionBlocks as any[]
    })

    window.message.success({ content: i18n.t('message.success.notion.export'), key: 'notion-success' })
    return response
  } catch (error: any) {
    window.message.error({ content: i18n.t('message.error.notion.export'), key: 'notion-error' })
    return null
  } finally {
    setExportState({
      isExporting: false
    })
  }
}

export const exportMarkdownToYuque = async (title: string, content: string) => {
  const { isExporting } = store.getState().runtime.export
  const { yuqueToken, yuqueRepoId } = store.getState().settings

  if (isExporting) {
    window.message.warning({ content: i18n.t('message.warn.yuque.exporting'), key: 'yuque-exporting' })
    return
  }

  if (!yuqueToken || !yuqueRepoId) {
    window.message.error({ content: i18n.t('message.error.yuque.no_config'), key: 'yuque-no-config-error' })
    return
  }

  setExportState({ isExporting: true })

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

    window.message.success({
      content: i18n.t('message.success.yuque.export'),
      key: 'yuque-success'
    })
    return data
  } catch (error: any) {
    window.message.error({
      content: i18n.t('message.error.yuque.export'),
      key: 'yuque-error'
    })
    return null
  } finally {
    setExportState({ isExporting: false })
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
export const exportMarkdownToObsidian = async (attributes: any) => {
  try {
    // 从参数获取Vault名称
    const obsidianValut = attributes.vault
    let obsidianFolder = attributes.folder || ''
    let isMarkdownFile = false

    if (!obsidianValut) {
      window.message.error(i18n.t('chat.topics.export.obsidian_not_configured'))
      return
    }

    if (!attributes.title) {
      window.message.error(i18n.t('chat.topics.export.obsidian_title_required'))
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

    let obsidianUrl = `obsidian://new?file=${encodeURIComponent(filePath)}&vault=${encodeURIComponent(obsidianValut)}&clipboard`

    if (attributes.processingMethod === '3') {
      obsidianUrl += '&overwrite=true'
    } else if (attributes.processingMethod === '2') {
      obsidianUrl += '&prepend=true'
    } else if (attributes.processingMethod === '1') {
      obsidianUrl += '&append=true'
    }

    window.open(obsidianUrl)
    window.message.success(i18n.t('chat.topics.export.obsidian_export_success'))
  } catch (error) {
    console.error('导出到Obsidian失败:', error)
    window.message.error(i18n.t('chat.topics.export.obsidian_export_failed'))
  }
}

/**
 * 生成Obsidian文件名,源自 Obsidian  Web Clipper 官方实现,修改了一些细节
 * @param fileName
 * @returns
 */

function transformObsidianFileName(fileName: string): string {
  const platform = window.navigator.userAgent
  const isWindows = /win/i.test(platform)
  const isMac = /mac/i.test(platform)

  // 删除Obsidian 全平台无效字符
  let sanitized = fileName.replace(/[#|\\^\\[\]]/g, '')

  if (isWindows) {
    // Windows 的清理
    sanitized = sanitized
      .replace(/[<>:"\\/\\|?*]/g, '') // 移除无效字符
      .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, '_$1$2') // 避免保留名称
      .replace(/[\s.]+$/, '') // 移除结尾的空格和句点
  } else if (isMac) {
    // Mac 的清理
    sanitized = sanitized
      .replace(/[/:\u0020-\u007E]/g, '') // 移除无效字符
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
export const exportMarkdownToJoplin = async (title: string, content: string) => {
  const { joplinUrl, joplinToken } = store.getState().settings

  if (!joplinUrl || !joplinToken) {
    window.message.error(i18n.t('message.error.joplin.no_config'))
    return
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

    window.message.success(i18n.t('message.success.joplin.export'))
    return
  } catch (error) {
    window.message.error(i18n.t('message.error.joplin.export'))
    return
  }
}

/**
 * 导出Markdown到思源笔记
 * @param title 笔记标题
 * @param content 笔记内容
 */
export const exportMarkdownToSiyuan = async (title: string, content: string) => {
  const { isExporting } = store.getState().runtime.export
  const { siyuanApiUrl, siyuanToken, siyuanBoxId, siyuanRootPath } = store.getState().settings

  if (isExporting) {
    window.message.warning({ content: i18n.t('message.warn.siyuan.exporting'), key: 'siyuan-exporting' })
    return
  }

  if (!siyuanApiUrl || !siyuanToken || !siyuanBoxId) {
    window.message.error({ content: i18n.t('message.error.siyuan.no_config'), key: 'siyuan-no-config-error' })
    return
  }

  setExportState({ isExporting: true })

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

    // 创建文档
    const docTitle = `${title.replace(/[#|\\^\\[\]]/g, '')}`
    const docPath = `${rootPath}/${docTitle}`

    // 创建文档
    await createSiyuanDoc(siyuanApiUrl, siyuanToken, siyuanBoxId, docPath, content)

    window.message.success({
      content: i18n.t('message.success.siyuan.export'),
      key: 'siyuan-success'
    })
  } catch (error) {
    console.error('导出到思源笔记失败:', error)
    window.message.error({
      content: i18n.t('message.error.siyuan.export') + (error instanceof Error ? `: ${error.message}` : ''),
      key: 'siyuan-error'
    })
  } finally {
    setExportState({ isExporting: false })
  }
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
