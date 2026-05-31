import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'

import { getTitleFromString } from './utils'
import { messageToMarkdown, topicToMarkdown } from './markdown'

  title: string,
  contentOrMessages: string | Message | Message[]
): Promise<any | null> => {
  const { joplinUrl, joplinToken, joplinExportReasoning, excludeCitationsInExport } = store.getState().settings

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
    content = messagesToMarkdown(contentOrMessages, joplinExportReasoning, excludeCitationsInExport)
  } else {
    // 单条Message
    content = joplinExportReasoning
      ? messageToMarkdownWithReasoning(contentOrMessages, excludeCitationsInExport)
      : messageToMarkdown(contentOrMessages, excludeCitationsInExport)
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