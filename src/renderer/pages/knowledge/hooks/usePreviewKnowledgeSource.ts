import { loggerService } from '@logger'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeKnowledgeError } from '../utils'

const logger = loggerService.withContext('usePreviewKnowledgeSource')

const isHttpUrl = (source: string) => {
  try {
    const url = new URL(source)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const usePreviewKnowledgeSource = () => {
  const { t } = useTranslation()

  const previewSource = useCallback(
    async (item: KnowledgeItem): Promise<void> => {
      const source = item.data.source.trim()

      if (!source) {
        window.toast.warning(t('knowledge.data_source.preview.unavailable'))
        return
      }

      try {
        if (item.type === 'url' || item.type === 'sitemap') {
          await window.api.shell.openExternal(source)
          return
        }

        if (item.type === 'note') {
          if (!isHttpUrl(source)) {
            window.toast.warning(t('knowledge.data_source.preview.unavailable'))
            return
          }

          await window.api.shell.openExternal(source)
          return
        }

        await window.api.file.openPath(source)
      } catch (error) {
        const previewError = normalizeKnowledgeError(error)

        logger.error('Failed to preview knowledge source', previewError, {
          itemId: item.id,
          itemType: item.type,
          source
        })
        window.toast.error(formatErrorMessageWithPrefix(previewError, t('knowledge.data_source.preview.failed')))
      }
    },
    [t]
  )

  return {
    previewSource
  }
}
