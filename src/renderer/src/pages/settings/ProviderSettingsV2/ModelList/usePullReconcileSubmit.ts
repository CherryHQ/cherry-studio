import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '@renderer/pages/settings/ProviderSettingsV2/hooks/providerSetting/constants'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { toCreateModelDto } from './modelSync'
import type { ModelPullApplyPayload } from './useModelListSyncSelections'

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

        if (toAdd.length > 0) {
          const dtos = toAdd.map((m) => toCreateModelDto(providerId, m))
          await createModels(dtos)
        }

        for (const uniqueModelId of toRemove) {
          const { modelId } = parseUniqueModelId(uniqueModelId)
          await deleteModel(providerId, modelId)
        }

        refetchModels()
        window.toast.success(
          t('settings.models.manage.sync_apply_result', {
            added: toAdd.length,
            deprecated: 0,
            deleted: toRemove.length
          })
        )
        onApplyCommitted()
      } catch {
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
