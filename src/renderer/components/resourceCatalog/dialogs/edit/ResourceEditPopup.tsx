import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { lazy, Suspense, useCallback } from 'react'

import type { ResourceEditDialogTarget } from './ResourceEditDialogHost'

const ResourceEditDialogHost = lazy(() =>
  import('./ResourceEditDialogHost').then((module) => ({ default: module.ResourceEditDialogHost }))
)

type ResourceEditPopupParams = {
  target: ResourceEditDialogTarget
}

function ResourceEditPopupContainer({ open, resolve, target }: ResourceEditPopupParams & PopupInjectedProps<void>) {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resolve(undefined)
    },
    [resolve]
  )

  return (
    <Suspense fallback={null}>
      <ResourceEditDialogHost target={target} open={open} onOpenChange={handleOpenChange} />
    </Suspense>
  )
}

export const ResourceEditPopup = createPopup<ResourceEditPopupParams, void>(ResourceEditPopupContainer)
