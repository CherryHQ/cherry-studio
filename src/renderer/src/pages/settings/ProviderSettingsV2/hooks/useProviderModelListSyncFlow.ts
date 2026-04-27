import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProviders'
import type { ModelSyncApplyDto } from '@shared/data/api/schemas/providers'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildModelListSyncPreview } from '../ModelList/buildModelListSyncPreview'
import type { ModelSyncPreviewResponse } from '../ModelList/modelSyncPreviewTypes'

const logger = loggerService.withContext('ProviderModelListSync')

export function useProviderModelListSyncFlow(providerId: string) {
  const { t } = useTranslation()
  const { provider, isLoading: providerLoading } = useProvider(providerId)
  const [preview, setPreview] = useState<ModelSyncPreviewResponse | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

  const isLoading = providerLoading || isPreviewLoading

  const reset = useCallback(() => {
    setPreview(null)
  }, [])

  const fetchPreview = useCallback(async () => {
    if (!provider) {
      return
    }
    setIsPreviewLoading(true)
    try {
      setPreview(
        await buildModelListSyncPreview({
          providerId,
          provider
        })
      )
    } catch (error) {
      logger.error('Model list sync preview failed', { providerId, error })
      setPreview(null)
      window.toast.error(t('settings.models.manage.sync_pull_failed'))
    } finally {
      setIsPreviewLoading(false)
    }
  }, [provider, providerId, t])

  const apply = useCallback(
    async (dto: ModelSyncApplyDto) => {
      setIsApplying(true)
      try {
        return await dataApiService.post(`/providers/${providerId}/model-sync:apply` as const, { body: dto })
      } catch (error) {
        logger.error('Model list sync apply failed', { providerId, error })
        window.toast.error(t('settings.models.manage.sync_pull_failed'))
        throw error
      } finally {
        setIsApplying(false)
      }
    },
    [providerId, t]
  )

  return {
    preview,
    isLoading,
    isApplying,
    fetchPreview,
    apply,
    reset
  }
}
