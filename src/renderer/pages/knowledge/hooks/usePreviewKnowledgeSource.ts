import { loggerService } from '@logger'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeUrl } from 'strict-url-sanitise'

import { normalizeKnowledgeError } from '../utils'

const logger = loggerService.withContext('usePreviewKnowledgeSource')

const sanitizeHttpUrl = (source: string): string | null => {
  try {
    const sanitizedUrl = sanitizeUrl(source)
    const url = new URL(sanitizedUrl)

    return url.protocol === 'http:' || url.protocol === 'https:' ? sanitizedUrl : null
  } catch {
    return null
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
        if (item.type === 'url' || item.type === 'note') {
          const previewUrl = sanitizeHttpUrl(source)
          if (!previewUrl) {
            window.toast.warning(t('knowledge.data_source.preview.unavailable'))
            return
          }

          await window.api.shell.openExternal(previewUrl)
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
