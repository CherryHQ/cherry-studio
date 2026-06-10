import { useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { useProviderPullReconcile as usePullPreview } from '@renderer/pages/settings/ProviderSettings/hooks/useProviderPullReconcile'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePullReconcileSubmit } from './usePullReconcileSubmit'

/**
 * Owns the manual pull-preview/apply drawer lifecycle for one provider.
 */
export function useProviderModelPullReconcile(providerId: string) {
  const { t } = useTranslation()
  const pullPreview = usePullPreview(providerId)
  const [pullReconcileDrawerOpen, setPullReconcileDrawerOpen] = useState(false)
  const { provider, updateProvider } = useProvider(providerId)
  const { models } = useModels({ providerId })

  const closePullReconcile = useCallback(() => {
    setPullReconcileDrawerOpen(false)
  }, [])

  const { confirmApply, applyBusy } = usePullReconcileSubmit({
    providerId,
    onApplyCommitted: closePullReconcile
  })

  const openPullReconcile = useCallback(async () => {
    try {
      const next = await pullPreview.fetchPreview()
      if (next == null) {
        return
      }
      const hasDiff = next.added.length > 0 || next.missing.length > 0
      if (!hasDiff) {
        // Up to date: no diff to apply, but the existing local models are valid
        // for the new key/host — enable the provider if it is currently disabled.
        await enableProviderWhenModelsAvailable(provider, updateProvider, models.length, 'pull_reconcile_up_to_date')
        window.toast.success(
          `${t('settings.models.manage.fetch_up_to_date')} ${t('settings.models.manage.fetch_up_to_date_hint')}`
        )
        pullPreview.reset()
        return
      }
      setPullReconcileDrawerOpen(true)
    } catch {
      /* toast + throw inside fetchPreview */
    }
  }, [models.length, provider, pullPreview, t, updateProvider])

  return {
    openPullReconcile,
    closePullReconcile,
    pullReconcileDrawerOpen,
    preview: pullPreview.preview,
    applyPullReconcile: confirmApply,
    isApplyingPullReconcile: applyBusy,
    isBusy: pullPreview.isPreviewLoading || applyBusy
  }
}
