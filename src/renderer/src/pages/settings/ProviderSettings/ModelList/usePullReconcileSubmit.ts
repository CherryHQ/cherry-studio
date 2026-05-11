import { loggerService } from '@logger'
import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '@renderer/pages/settings/ProviderSettings/hooks/providerSetting/constants'
import { chunkArray } from '@renderer/pages/settings/ProviderSettings/utils/chunkArray'
import { MODELS_BATCH_MAX_ITEMS } from '@shared/data/api/schemas/models'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { toCreateModelDto } from './modelSync'
import type { ModelPullApplyPayload } from './useModelListSyncSelections'

const logger = loggerService.withContext('ProviderSettings:PullReconcileSubmit')

type UsePullReconcileSubmitOptions = {
  providerId: string
  /** After DB writes + cache refresh; closes UI that owns drawer + preview. */
  onApplyCommitted: () => void
}

/**
 * Applies pull-reconcile selection: batch create + sequential delete for selected rows.
 */
export function usePullReconcileSubmit({ providerId, onApplyCommitted }: UsePullReconcileSubmitOptions) {
  const { t } = useTranslation()
  const { refetch: refetchModels } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { createModels, deleteModel, isCreating, isDeleting } = useModelMutations()

  const confirmApply = useCallback(
    async (payload: ModelPullApplyPayload) => {
      try {
        const { toAdd, toRemove } = payload

        for (const uniqueModelId of toRemove) {
          const { modelId } = parseUniqueModelId(uniqueModelId)
          await deleteModel(providerId, modelId)
        }

        if (toAdd.length > 0) {
          const dtos = toAdd.map((model) => toCreateModelDto(providerId, model))
          for (const chunk of chunkArray(dtos, MODELS_BATCH_MAX_ITEMS)) {
            await createModels(chunk)
          }
        }

        void refetchModels()
        window.toast.success(
          t('settings.models.manage.sync_apply_result', {
            added: toAdd.length,
            deprecated: 0,
            deleted: toRemove.length
          })
        )
        onApplyCommitted()
      } catch (error) {
        logger.error('Failed to apply pull reconcile selection', { providerId, error })
        window.toast.error(t('settings.models.manage.sync_pull_failed'))
      }
    },
    [createModels, deleteModel, onApplyCommitted, providerId, refetchModels, t]
  )

  return {
    confirmApply,
    applyBusy: isCreating || isDeleting
  }
}
