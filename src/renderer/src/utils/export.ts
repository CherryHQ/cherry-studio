import { Client } from '@notionhq/client'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { getMessageTitle } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { setExportState } from '@renderer/store/runtime'
import { Message, Topic } from '@renderer/types'
import { removeSpecialCharactersForFileName } from '@renderer/utils/index'

export const messageToMarkdown = (message: Message) => {
  const roleText = message.role === 'user' ? '🧑‍💻 User' : '🤖 Assistant'
  const titleSection = `### ${roleText}`
  const contentSection = message.content
  const tavilyCitations = message?.metadata?.tavily?.results
    ?.map((result, index) => {
      return `[^${index + 1}]: [${result.title}](${result.url})`
    })
    .join('\n')
  const PerplexityCitations = message?.metadata?.citations
    ?.map((citation, index) => {
      return `[^${index + 1}]: ${citation}`
    })
    .join('\n')

  const citations = [tavilyCitations, PerplexityCitations].join('\n')
  return [titleSection, '', contentSection, '', citations].join('\n')
}

export const messagesToMarkdown = (messages: Message[]) => {
  return messages.map((message) => messageToMarkdown(message)).join('\n\n---\n\n')
}

export const topicToMarkdown = async (topic: Topic) => {
  const topicName = `# ${topic.name}`
  const topicMessages = await db.topics.get(topic.id)

  if (!topicMessages) {
    return ''
  }
  let markdown = topicName + '\n\n' + messagesToMarkdown(topicMessages.messages)

  // 判断markdown中是否存在相同的脚注引用
  let haveSameReferences = false
  const references: string[] = []
  for (const line of markdown.split('\n')) {
    if (line.startsWith('[^')) {
      const number = line.match(/\[\^(\d+)\]/)?.[1]
      if (number) {
        if (references.includes(number)) {
          haveSameReferences = true
          break
        }
        references.push(number)
      }
    }
  }

  if (haveSameReferences) {
    // 如果markdown中存在相同的脚注引用，则把markdown中的[^number]替换为(number)，避免脚注引用错误，详情见#2712
    markdown = markdown.replace(/\[\^(\d+)\]/g, '($1)')
  }
  return markdown
}

export const exportTopicAsMarkdown = async (topic: Topic) => {
  const fileName = removeSpecialCharactersForFileName(topic.name) + '.md'
  const markdown = await topicToMarkdown(topic)
  window.api.file.save(fileName, markdown)
}

export const exportMessageAsMarkdown = async (message: Message) => {
  const fileName = getMessageTitle(message) + '.md'
  const markdown = messageToMarkdown(message)
  window.api.file.save(fileName, markdown)
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

// 创建页面标题块
const createPageTitleBlocks = (title: string, pageNumber: number, totalPages: number) => {
  return [
    {
      object: 'block',
      type: 'heading_1',
      heading_1: {
        rich_text: [{ type: 'text', text: { content: `${title} (${pageNumber}/${totalPages})` } }]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: []
      }
    }
  ]
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
    const requestBody = JSON.stringify({ md: markdown })

    const res = await fetch('https://md2notion.hilars.dev', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: requestBody
    })

    const data = await res.json()
    const allBlocks = data
    const blockPages = splitNotionBlocks(allBlocks)

    if (blockPages.length === 0) {
      throw new Error('No content to export')
    }

    // 创建主页面和子页面
    let mainPageResponse: any = null
    for (let i = 0; i < blockPages.length; i++) {
      const pageTitle = blockPages.length > 1 ? `${topic.name} (${i + 1}/${blockPages.length})` : topic.name
      const pageBlocks = blockPages[i]

      const pageContent =
        i === 0 ? pageBlocks : [...createPageTitleBlocks(topic.name, i + 1, blockPages.length), ...pageBlocks]

      const response = await notion.pages.create({
        parent: { database_id: notionDatabaseID },
        properties: {
          [store.getState().settings.notionPageNameKey || 'Name']: {
            title: [{ text: { content: pageTitle } }]
          }
        },
        children: pageContent
      })

      // 保存主页面响应
      if (i === 0) {
        mainPageResponse = response
      }
    }

    window.message.success({ content: i18n.t('message.success.notion.export'), key: 'notion-success' })
    return mainPageResponse
  } catch (error: any) {
    window.message.error({ content: i18n.t('message.error.notion.export'), key: 'notion-error' })
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
    const requestBody = JSON.stringify({ md: content })

    const res = await fetch('https://md2notion.hilars.dev', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: requestBody
    })

    const data = await res.json()
    const notionBlocks = data

    const response = await notion.pages.create({
      parent: { database_id: notionDatabaseID },
      properties: {
        [store.getState().settings.notionPageNameKey || 'Name']: {
          title: [{ text: { content: title } }]
        }
      },
      children: notionBlocks
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
