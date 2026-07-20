import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { isSelectableAssistantModel } from '@renderer/utils/resourceCatalog'
import { lazy, Suspense, useCallback, useState } from 'react'

import type { AssistantEditDialogResource } from './AssistantEditDialog'

const AssistantEditDialog = lazy(() =>
  import('./AssistantEditDialog').then((module) => ({ default: module.AssistantEditDialog }))
)
const AgentEditDialog = lazy(() => import('./AgentEditDialog').then((module) => ({ default: module.AgentEditDialog })))

type ResourceEditPopupParams =
  | { kind: 'assistant'; resource: AssistantEditDialogResource }
  | { kind: 'agent'; resource: AgentDetail }

function ResourceEditPopupContainer({ open, resolve, ...params }: ResourceEditPopupParams & PopupInjectedProps<void>) {
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resolve(undefined)
    },
    [resolve]
  )

  return (
    <Suspense fallback={null}>
      {params.kind === 'assistant' ? (
        <AssistantResourceEditPopup open={open} onOpenChange={handleOpenChange} initialResource={params.resource} />
      ) : (
        <AgentResourceEditPopup open={open} onOpenChange={handleOpenChange} initialResource={params.resource} />
      )}
    </Suspense>
  )
}

function AssistantResourceEditPopup({
  open,
  onOpenChange,
  initialResource
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialResource: AssistantEditDialogResource
}) {
  const [resource, setResource] = useState(initialResource)

  return (
    <AssistantEditDialog
      open={open}
      resource={resource}
      onOpenChange={onOpenChange}
      onSaved={setResource}
      modelFilter={isSelectableAssistantModel}
    />
  )
}

function AgentResourceEditPopup({
  open,
  onOpenChange,
  initialResource
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialResource: AgentDetail
}) {
  const [resource, setResource] = useState(initialResource)
  const modelFilter = useAgentModelFilter('claude-code')

  return (
    <AgentEditDialog
      open={open}
      resource={resource}
      onOpenChange={onOpenChange}
      onSaved={setResource}
      modelFilter={modelFilter}
    />
  )
}

export const ResourceEditPopup = createPopup<ResourceEditPopupParams, void>(ResourceEditPopupContainer)
