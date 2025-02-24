import { Client } from '@notionhq/client'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import { getMessageTitle } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { setExportState } from '@renderer/store/runtime'
import { Message, Topic } from '@renderer/types'

export const messageToMarkdown = (message: Message) => {
  const roleText = message.role === 'user' ? '🧑‍💻 User' : '🤖 Assistant'
  const titleSection = `### ${roleText}`
  const contentSection = message.content

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
  const fileName = topic.name + '.md'
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
