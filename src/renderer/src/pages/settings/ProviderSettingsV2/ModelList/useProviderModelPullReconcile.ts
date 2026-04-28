import { useProviderPullReconcile as usePullPreview } from '@renderer/pages/settings/ProviderSettingsV2/hooks/useProviderPullReconcile'
import { useCallback, useState } from 'react'

import { usePullReconcileSubmit } from './usePullReconcileSubmit'

/**
 * Owns the manual pull-preview/apply drawer lifecycle for one provider.
 */
export function useProviderModelPullReconcile(providerId: string) {
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
      if (next != null) {
        setPullReconcileDrawerOpen(true)
      }
    } catch {
      /* toast + throw inside fetchPreview */
    }
  }, [pullPreview.fetchPreview])

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
