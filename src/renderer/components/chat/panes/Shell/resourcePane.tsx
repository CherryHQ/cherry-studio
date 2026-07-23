import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { createContext, type ReactNode, use, useEffect, useRef } from 'react'

import { useRightPanelActions } from './RightPanel'

// ── Resource-list-as-right-pane wiring ──────────────────────────────────────
// In classic-layout mode the topic/session list moves into the
// chat's right pane as an extra capability. The list node + its label are provided
// once at the page level; the domain capability declaration decides when to mount it.

export const RESOURCE_PANE_TAB = 'resources'

export type ResourcePaneConfig = {
  /** The resource list mounts on first presentation and stays alive while the capability remains available. */
  node: ReactNode
  /** Tab label + toggle tooltip source — pages supply the product word ("topic" / "session"). */
  label: string
}

const ResourcePaneContext = createContext<ResourcePaneConfig | null>(null)

export function ResourcePaneProvider({ value, children }: { value: ResourcePaneConfig | null; children: ReactNode }) {
  return <ResourcePaneContext value={value}>{children}</ResourcePaneContext>
}

/** Returns the active resource-pane config, or null when the page is in left (sidebar) mode. */
export function useResourcePane(): ResourcePaneConfig | null {
  return use(ResourcePaneContext)
}

/**
 * Opens the right resource pane when a *locate* request arrives (history records / global search),
 * so the located topic/session is actually visible. Passive "reveal current" requests don't set
 * `clearFilters`, so ordinary topic/tab switches never force the pane open. Classic layout only —
 * outside it there is no resource pane to open. Mount inside RightPanelProvider.
 */
export function ResourcePaneLocateOpener({ revealRequest }: { revealRequest?: ResourceListRevealRequest }) {
  const actions = useRightPanelActions()
  const resourcePane = useResourcePane()
  const handledRequestIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!resourcePane || !revealRequest?.clearFilters) return
    if (!actions.canOpen(RESOURCE_PANE_TAB)) return
    if (handledRequestIdRef.current === revealRequest.requestId) return
    handledRequestIdRef.current = revealRequest.requestId
    actions.tryOpen(RESOURCE_PANE_TAB)
  }, [actions, resourcePane, revealRequest])

  return null
}
