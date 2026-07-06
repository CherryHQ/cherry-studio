import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import { List } from 'lucide-react'
import { createContext, type ReactNode, use, useEffect, useRef } from 'react'

import { Shell, useShellActions } from './Shell'

// ── Resource-list-as-right-pane wiring ──────────────────────────────────────
// In classic-layout mode (`topic.layout`/`agent.layout === 'classic'`) the topic/session list moves into the
// chat's right pane as an extra tab. The list node + its label are provided once at
// the page level via context, so the Chat/AgentChat tree and the pane surfaces don't prop-thread
// them through every layer. The tab/panel/toggle below derive everything from this context, and
// render nothing in left (sidebar) mode where the context is null.

export const RESOURCE_PANE_TAB = 'resources'

export type ResourcePaneConfig = {
  /** The resource list to mount inside the right pane. */
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

/** Shared `resources` tab-strip entry. Renders nothing outside classic layout. Place inside `Shell.TabList`. */
export function ResourcePaneTab() {
  const config = useResourcePane()
  if (!config) return null

  return (
    <Shell.Tab value={RESOURCE_PANE_TAB} icon={<List className="size-3.5" />}>
      {config.label}
    </Shell.Tab>
  )
}

/** Shared `resources` tab panel. Renders nothing outside classic layout. Place inside `Shell.Tabs`. */
export function ResourcePanePanel() {
  const config = useResourcePane()
  if (!config) return null

  return (
    <Shell.Panel value={RESOURCE_PANE_TAB} forceMount>
      {config.node}
    </Shell.Panel>
  )
}

/**
 * Opens the right resource pane when a *locate* request arrives (history records / global search),
 * so the located topic/session is actually visible. Passive "reveal current" requests don't set
 * `clearFilters`, so ordinary topic/tab switches never force the pane open. Classic layout only —
 * outside it there is no resource pane to open. Mount inside the Shell tree.
 */
export function ResourcePaneLocateOpener({ revealRequest }: { revealRequest?: ResourceListRevealRequest }) {
  const actions = useShellActions()
  const resourcePane = useResourcePane()
  const handledRequestIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!resourcePane || !revealRequest?.clearFilters) return
    if (handledRequestIdRef.current === revealRequest.requestId) return
    handledRequestIdRef.current = revealRequest.requestId
    actions.openTab(RESOURCE_PANE_TAB)
  }, [actions, resourcePane, revealRequest])

  return null
}
