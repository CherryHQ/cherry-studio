import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
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
 * Applies pull-reconcile selection as one atomic reconcile call so partial
 * failure cannot leave the user with half-applied deletes + adds after they
 * confirmed the diff in the preview drawer.
 */
export function usePullReconcileSubmit({ providerId, onApplyCommitted }: UsePullReconcileSubmitOptions) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const { trigger: reconcileTrigger, isLoading: applyBusy } = useMutation(
    'POST',
    '/providers/:providerId/models:reconcile',
    { refresh: ['/models'] }
  )

  const confirmApply = useCallback(
    async (payload: ModelPullApplyPayload) => {
      try {
        const { toAdd, toRemove } = payload
        const reconciledModels = await reconcileTrigger({
          params: { providerId },
          body: {
            toAdd: toAdd.map((model) => toCreateModelDto(providerId, model)),
            toRemove
          }
        })
        await enableProviderWhenModelsAvailable(
          provider,
          updateProvider,
          reconciledModels.length,
          'pull_reconcile_apply'
        )

        // Detect models that were skipped from removal because they're in use
        // as default / quick / translate models.
        const reconciledIds = new Set(reconciledModels.map((m: { id: string }) => m.id))
        const skippedIds = toRemove.filter((id) => reconciledIds.has(id))
        const actualDeleted = toRemove.length - skippedIds.length

        if (skippedIds.length > 0) {
          window.toast.warning(t('settings.models.manage.sync_apply_default_in_use'))
        } else {
          window.toast.success(
            t('settings.models.manage.sync_apply_result', {
              added: toAdd.length,
              deprecated: 0,
              deleted: actualDeleted
            })
          )
        }
        onApplyCommitted()
      } catch (error) {
        logger.error('Failed to apply pull reconcile selection', { providerId, error })
        window.toast.error(t('settings.models.manage.sync_pull_failed'))
      }
    },
    [onApplyCommitted, provider, providerId, reconcileTrigger, t, updateProvider]
  )

  return {
    confirmApply,
    applyBusy
  }
}
