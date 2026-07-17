import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import { getKnowledgeItemDisplayTitle, type KnowledgeItem } from '@shared/data/types/knowledge'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeUrl } from 'strict-url-sanitise'

import type { KnowledgeFilePreviewTarget } from '../types'
import { normalizeKnowledgeError } from '../utils/error'

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

export const usePreviewKnowledgeSource = (onPreviewFile: (target: KnowledgeFilePreviewTarget) => void) => {
  const { t } = useTranslation()

  const previewSource = useCallback(
    async (item: KnowledgeItem): Promise<void> => {
      const source = item.data.source.trim()

      if (!source) {
        toast.warning(t('knowledge.data_source.preview.unavailable'))
        return
      }

      try {
        if (item.type === 'file' || (item.type === 'url' && item.data.relativePath)) {
          const physicalPath = await ipcApi.request('knowledge.get_file_path', { itemId: item.id })
          onPreviewFile({
            fileName: getKnowledgeItemDisplayTitle(item),
            filePath: normalizeFilePreviewPath(physicalPath)
          })
          return
        }

        if (item.type === 'url' || item.type === 'note') {
          const previewUrl = sanitizeHttpUrl(source)
          if (!previewUrl) {
            toast.warning(t('knowledge.data_source.preview.unavailable'))
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
        toast.error(formatErrorMessageWithPrefix(previewError, t('knowledge.data_source.preview.failed')))
      }
    },
    [onPreviewFile, t]
  )

  return {
    previewSource
  }
}
