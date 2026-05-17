import { loggerService } from '@logger'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildModelListSyncPreview } from '../ModelList/buildModelListSyncPreview'
import { ModelSyncError } from '../ModelList/modelSync'
import type { ModelSyncPreviewResponse } from '../ModelList/modelSyncPreviewTypes'

const logger = loggerService.withContext('ProviderPullReconcile')

/**
 * Pull reconcile preview: remote vs local diff until the user applies or dismisses.
 */
export function useProviderPullReconcile(providerId: string) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<ModelSyncPreviewResponse | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)

  const reset = useCallback(() => {
    setPreview(null)
  }, [])

  const fetchPreview = useCallback(async (): Promise<ModelSyncPreviewResponse | null> => {
    setIsPreviewLoading(true)
    try {
      const next = await buildModelListSyncPreview({ providerId })
      setPreview(next)
      return next
    } catch (error) {
      logger.error('Pull reconcile preview failed', { providerId, error })
      setPreview(null)
      if (error instanceof ModelSyncError && error.code === 'NO_ENABLED_API_KEY') {
        window.toast.error(t('settings.models.check.no_api_keys'))
      } else {
        window.toast.error(t('settings.models.manage.sync_pull_failed'))
      }
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      setIsPreviewLoading(false)
    }
  }, [providerId, t])

  return {
    preview,
    isPreviewLoading,
    fetchPreview,
    reset
  }
}
