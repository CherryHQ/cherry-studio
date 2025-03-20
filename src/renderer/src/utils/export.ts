import { Client } from '@notionhq/client'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { getMessageTitle } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { setExportState } from '@renderer/store/runtime'
import { Message, Topic } from '@renderer/types'
import { convertMathFormula, removeSpecialCharactersForFileName } from '@renderer/utils/index'
import { markdownToBlocks } from '@tryfabric/martian'
import dayjs from 'dayjs'

export const messageToMarkdown = (message: Message) => {
  const { forceDollarMathInMarkdown } = store.getState().settings
  const roleText = message.role === 'user' ? '🧑‍💻 User' : '🤖 Assistant'
  const titleSection = `### ${roleText}`
  const contentSection = forceDollarMathInMarkdown ? convertMathFormula(message.content) : message.content

  return [titleSection, '', contentSection].join('\n')
}

export const messagesToMarkdown = (messages: Message[]) => {
  return messages.map((message) => messageToMarkdown(message)).join('\n\n---\n\n')
}

export const topicToMarkdown = async (topic: Topic) => {
  const topicName = `# ${topic.name}`
  const topicMessages = await db.topics.get(topic.id)

  if (topicMessages) {
    return topicName + '\n\n' + messagesToMarkdown(topicMessages.messages)
  }

  return ''
}

export const exportTopicAsMarkdown = async (topic: Topic) => {
  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const fileName = removeSpecialCharactersForFileName(topic.name) + '.md'
      const markdown = await topicToMarkdown(topic)
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
      const markdown = await topicToMarkdown(topic)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.message.success({ content: i18n.t('message.success.markdown.export.preconf'), key: 'markdown-success' })
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.preconf'), key: 'markdown-error' })
    }
  }
}

export const exportMessageAsMarkdown = async (message: Message) => {
  const { markdownExportPath } = store.getState().settings
  if (!markdownExportPath) {
    try {
      const fileName = removeSpecialCharactersForFileName(getMessageTitle(message)) + '.md'
      const markdown = messageToMarkdown(message)
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
      const fileName = removeSpecialCharactersForFileName(getMessageTitle(message)) + ` ${timestamp}.md`
      const markdown = messageToMarkdown(message)
      await window.api.file.write(markdownExportPath + '/' + fileName, markdown)
      window.message.success({ content: i18n.t('message.success.markdown.export.preconf'), key: 'markdown-success' })
    } catch (error: any) {
      window.message.error({ content: i18n.t('message.error.markdown.export.preconf'), key: 'markdown-error' })
    }
  }
}

const convertMarkdownToNotionBlocks = async (markdown: string) => {
  return markdownToBlocks(markdown)
}
// 修改 splitNotionBlocks 函数
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
 */
export const exportMarkdownToObsidian = async (attributes: any) => {
  try {
    const obsidianValut = store.getState().settings.obsidianValut
    const obsidianFolder = store.getState().settings.obsidianFolder

    if (!obsidianValut || !obsidianFolder) {
      window.message.error(i18n.t('chat.topics.export.obsidian_not_configured'))
      return
    }
    let path = ''

    if (!attributes.title) {
      window.message.error(i18n.t('chat.topics.export.obsidian_title_required'))
      return
    }

    //构建保存路径添加以 / 结尾
    if (!obsidianFolder.endsWith('/')) {
      path = obsidianFolder + '/'
    }
    //构建文件名
    const fileName = transformObsidianFileName(attributes.title)

    let obsidianUrl = `obsidian://new?file=${encodeURIComponent(path + fileName)}&vault=${encodeURIComponent(obsidianValut)}&clipboard`

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
