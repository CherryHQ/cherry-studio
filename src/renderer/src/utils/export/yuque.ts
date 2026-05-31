import type { Message } from '@renderer/types/newMessage'

import { getTitleFromString } from './utils'
import { topicToMarkdown } from './markdown'

  const { yuqueToken, yuqueRepoId } = store.getState().settings

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