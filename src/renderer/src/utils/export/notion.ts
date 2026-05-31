import { Client } from '@notionhq/client'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { markdownToBlocks } from '@tryfabric/martian'
import { appendBlocks } from 'notion-helper'

import { createBaseMarkdown, getTitleFromString, processCitations, sanitizeReasoningContent } from './utils'
import { messageToMarkdownWithReasoning, topicToMarkdown } from './markdown'

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

  const { notionDatabaseID, notionApiKey } = store.getState().settings
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
        [store.getState().settings.notionPageNameKey || 'Name']: {
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
  const { notionExportReasoning } = store.getState().settings

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
  const { notionExportReasoning, excludeCitationsInExport } = store.getState().settings

  const topicMessages = await fetchTopicMessages(topic.id)

  // 创建话题标题块
  const titleBlocks = await convertMarkdownToNotionBlocks(`# ${topic.name}`)

  // 为每个消息创建blocks
  const allBlocks: any[] = [...titleBlocks]

  for (const message of topicMessages) {
    // 将单个消息转换为markdown
    const messageMarkdown = messageToMarkdown(message, excludeCitationsInExport)
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