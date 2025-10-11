import { loggerService } from '@logger'
import { message } from 'antd'
import React, { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('KnowledgeSearchItem hooks')

/**
 * 用于高亮搜索关键词的hook
 */
export const useHighlightText = () => {
  const highlightText = (text: string, searchKeyword: string): (string | ReactElement)[] => {
    if (!searchKeyword) return [text]

    // Escape special characters in the search keyword
    const escapedKeyword = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escapedKeyword})`, 'gi'))

    return parts.map((part, i) =>
      part.toLowerCase() === searchKeyword.toLowerCase() ? React.createElement('mark', { key: i }, part) : part
    )
  }

  return { highlightText }
}

/**
 * 用于复制文本到剪贴板的hook
 */
export const useCopyText = () => {
  const { t } = useTranslation()

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(t('message.copied'))
    } catch (error) {
      logger.error('Failed to copy text:', error as Error)
      window.toast.error(t('message.error.copy') || 'Failed to copy text')
    }
  }

  return { handleCopy }
}
