import React, { useCallback, useEffect, useState } from 'react'

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ResourceEditDialogTarget } from '@renderer/types/resourceCatalog'

// Lazy so the edit dialog (and its heavy form deps) stay out of the composer bundle until requested.
const ResourceEditDialogHost = React.lazy(() =>
  import('./edit').then((module) => ({ default: module.ResourceEditDialogHost }))
)

/**
 * Request the resource edit dialog to open from anywhere (e.g. a composer quick-panel footer),
 * decoupled from the component that renders it. Pick it up by mounting {@link ResourceEditDialogEventHost}.
 */
export function openResourceEditDialog(target: ResourceEditDialogTarget) {
  void EventEmitter.emit(EVENT_NAMES.OPEN_RESOURCE_EDIT_DIALOG, target)
}

/**
 * Mount once in the conversation page so requests keep working as composer modes change.
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
