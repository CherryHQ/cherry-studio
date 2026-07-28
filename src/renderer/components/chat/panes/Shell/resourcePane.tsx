import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { type ReactNode, useEffect, useRef } from 'react'

import { type RightPanelCapability, type RightPanelComponentProps, useRightPanelActions } from './RightPanel'

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

interface ResourcePaneCapabilityScope {
  resourcePane: ResourcePaneConfig | null
}

function ResourcePaneRightPanel<TScope extends ResourcePaneCapabilityScope>({
  scope
}: RightPanelComponentProps<TScope>) {
  return scope.resourcePane?.node ?? null
}

/** Create once at module scope so the capability catalog keeps a stable identity. */
export function createResourcePaneCapability<TScope extends ResourcePaneCapabilityScope>({
  instanceKey = RESOURCE_PANE_TAB
}: {
  instanceKey?: string
} = {}): RightPanelCapability<TScope> {
  return {
    component: ResourcePaneRightPanel,
    resolve: (scope) => ({
      id: RESOURCE_PANE_TAB,
      instanceKey,
      title: scope.resourcePane?.label ?? '',
      readiness: scope.resourcePane ? 'ready' : 'unavailable'
    })
  }
}

/**
 * Opens the right resource pane when a *locate* request arrives (history records / global search),
 * so the located topic/session is actually visible. Passive "reveal current" requests don't set
 * `clearFilters`, so ordinary topic/tab switches never force the pane open. Classic layout only —
 * outside it there is no resource pane to open. Mount inside RightPanelProvider.
 */
export function ResourcePaneLocateOpener({ revealRequest }: { revealRequest?: ResourceListRevealRequest }) {
  const actions = useRightPanelActions()
  const handledRequestIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!revealRequest?.clearFilters) return
    if (!actions.canOpen(RESOURCE_PANE_TAB)) return
    if (handledRequestIdRef.current === revealRequest.requestId) return
    handledRequestIdRef.current = revealRequest.requestId
    actions.tryOpen(RESOURCE_PANE_TAB)
  }, [actions, revealRequest])

  return null
}
