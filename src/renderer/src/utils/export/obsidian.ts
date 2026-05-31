import { markdownToPlainText } from '@renderer/utils/markdown'

import { getTitleFromString } from './utils'

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