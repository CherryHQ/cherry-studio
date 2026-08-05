import { emojiTabIcon } from '@renderer/utils/tabIcons'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { TabInstanceAppId } from '@shared/types/tabInstanceMetadata'
import { useEffect } from 'react'

import { useCurrentTabId } from './useCurrentTab'
import { useOptionalTabsContext } from './useTabsContext'

export interface TabSelfVisuals {
  title: string
  emoji?: string | null
  /** Route-ownership guard: only stamp while the tab is on this app's routes. */
  appId?: TabInstanceAppId
  /** Keep the tab's stored title/icon while the bound conversation is still loading. */
  preserveVisuals?: boolean
}

const TAB_APP_ROUTE_PREFIX: Record<TabInstanceAppId, string> = {
  assistants: '/app/chat',
  agents: '/app/agents'
}

function tabBelongsToApp(tab: Pick<Tab, 'url'>, appId: TabInstanceAppId): boolean {
  const routePrefix = TAB_APP_ROUTE_PREFIX[appId]
  return tab.url === routePrefix || tab.url.startsWith(`${routePrefix}?`) || tab.url.startsWith(`${routePrefix}/`)
}

/**
 * Sync this tab's own title / icon into the tab model. Presentation only — the
 * tab's conversation identity lives in its URL. The owning page passes its
 * derived visuals; everything tab-specific (emoji → icon descriptor mapping,
 * which tab id, change dedupe) stays here so the page never touches the tab
 * system or the `Tab` shape. No-op without a TabsProvider / TabIdProvider
 * (tests, detached popups).
 */
export function useTabSelfVisuals({ title, emoji, appId, preserveVisuals = false }: TabSelfVisuals): void {
  const currentTabId = useCurrentTabId()
  const tabsContext = useOptionalTabsContext()
  const updateTab = tabsContext?.updateTab
  const currentTab = tabsContext?.tabs.find((tab) => tab.id === currentTabId)

  useEffect(() => {
    if (!currentTabId || !updateTab || !currentTab) return
    if (preserveVisuals) return
    if (appId && !tabBelongsToApp(currentTab, appId)) return
    const icon = emojiTabIcon(emoji)
    if (currentTab.title === title && currentTab.icon === icon) return
    updateTab(currentTabId, { title, icon })
  }, [currentTabId, currentTab, updateTab, title, emoji, appId, preserveVisuals])
}
