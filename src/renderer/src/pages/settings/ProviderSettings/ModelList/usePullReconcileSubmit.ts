import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
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
  const { trigger: reconcileTrigger, isLoading: applyBusy } = useMutation(
    'POST',
    '/providers/:providerId/models:reconcile',
    { refresh: ['/models'] }
  )

  const confirmApply = useCallback(
    async (payload: ModelPullApplyPayload) => {
      try {
        const { toAdd, toRemove } = payload
        await reconcileTrigger({
          params: { providerId },
          body: {
            toAdd: toAdd.map((model) => toCreateModelDto(providerId, model)),
            toRemove
          }
        })
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
    [onApplyCommitted, providerId, reconcileTrigger, t]
  )

  return {
    confirmApply,
    applyBusy
  }
}
