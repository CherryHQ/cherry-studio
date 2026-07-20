import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import React, { useCallback, useEffect, useState } from 'react'

import type { ResourceEditDialogTarget } from './ResourceEditDialogHost'

// Lazy so the edit dialog (and its heavy form deps) stay out of the composer bundle until requested.
const ResourceEditDialogHost = React.lazy(() =>
  import('./ResourceEditDialogHost').then((module) => ({ default: module.ResourceEditDialogHost }))
)

/**
 * Request the resource edit dialog to open from anywhere (e.g. a composer quick-panel footer),
 * decoupled from the component that renders it. Pick it up by mounting {@link ResourceEditDialogEventHost}.
 */
export function openResourceEditDialog(target: ResourceEditDialogTarget) {
  void EventEmitter.emit(EVENT_NAMES.OPEN_RESOURCE_EDIT_DIALOG, target)
}

/**
 * Listens for {@link openResourceEditDialog} requests and hosts the edit dialog. Mount one per
 * surface that should be able to open it (e.g. each composer variant); it renders nothing until a
 * request arrives.
 */
export function ResourceEditDialogEventHost() {
  const [target, setTarget] = useState<ResourceEditDialogTarget | null>(null)

  useEffect(
    () =>
      EventEmitter.on(EVENT_NAMES.OPEN_RESOURCE_EDIT_DIALOG, (payload) =>
        setTarget(payload as ResourceEditDialogTarget)
      ),
    []
  )

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setTarget(null)
  }, [])

  if (!target) return null

  return (
    <React.Suspense fallback={null}>
      <ResourceEditDialogHost target={target} onOpenChange={handleOpenChange} />
    </React.Suspense>
  )
}
