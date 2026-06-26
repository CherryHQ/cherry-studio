import { MessageSquareText } from 'lucide-react'
import { createContext, type ReactNode, use } from 'react'

import { Shell } from './Shell'

// ── Resource-list-as-right-pane wiring ──────────────────────────────────────
// In old-view mode (`chat.conversation_view`/`chat.work_view === 'old'`) the topic/session list moves into the
// chat's right pane as an extra tab. The list node + its label + disabled flag are provided once at
// the page level via context, so the Chat/AgentChat tree and the pane surfaces don't prop-thread
// them through every layer. The tab/panel/toggle below derive everything from this context, and
// render nothing in left (sidebar) mode where the context is null.

export const RESOURCE_PANE_TAB = 'resources'

export type ResourcePaneConfig = {
  /** The resource list to mount inside the right pane. */
  node: ReactNode
  /** Tab label + toggle tooltip source — pages supply the product word ("topic" / "work"). */
  label: string
  disabled?: boolean
}

const ResourcePaneContext = createContext<ResourcePaneConfig | null>(null)

export function ResourcePaneProvider({ value, children }: { value: ResourcePaneConfig | null; children: ReactNode }) {
  return <ResourcePaneContext value={value}>{children}</ResourcePaneContext>
}

/** Returns the active resource-pane config, or null when the page is in left (sidebar) mode. */
export function useResourcePane(): ResourcePaneConfig | null {
  return use(ResourcePaneContext)
}

/** Shared `resources` tab-strip entry. Renders nothing outside right mode. Place inside `Shell.TabList`. */
export function ResourcePaneTab() {
  const config = useResourcePane()
  if (!config) return null

  return (
    <Shell.Tab value={RESOURCE_PANE_TAB} icon={<MessageSquareText className="size-3.5" />}>
      {config.label}
    </Shell.Tab>
  )
}

/** Shared `resources` tab panel. Renders nothing outside right mode. Place inside `Shell.Tabs`. */
export function ResourcePanePanel() {
  const config = useResourcePane()
  if (!config) return null

  return (
    <Shell.Panel value={RESOURCE_PANE_TAB} forceMount>
      {config.node}
    </Shell.Panel>
  )
}
