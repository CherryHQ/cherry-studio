import { useProviderPullReconcile as usePullPreview } from '@renderer/pages/settings/ProviderSettingsV2/hooks/useProviderPullReconcile'
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

  const closePullReconcile = useCallback(() => {
    setPullReconcileDrawerOpen(false)
    pullPreview.reset()
  }, [pullPreview.reset])

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
  }, [pullPreview.fetchPreview, pullPreview.reset, t])

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
