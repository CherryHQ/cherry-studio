import type { Message } from '@renderer/types/newMessage'

import { getTitleFromString } from './utils'
import { topicToMarkdown } from './markdown'

  const { siyuanApiUrl, siyuanToken, siyuanBoxId, siyuanRootPath } = store.getState().settings

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