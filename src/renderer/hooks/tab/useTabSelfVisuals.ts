import { useEffect } from 'react'

import { emojiTabIcon } from '@renderer/utils/tabIcons'

import { useCurrentTabId } from './useCurrentTab'
import { useOptionalTabsContext } from './useTabsContext'

export interface TabSelfVisuals {
  title: string
  emoji?: string | null
  icon?: string
  /** Only stamp while the current tab URL belongs to this caller-supplied route prefix. */
  routePrefix?: string
  /** Keep the tab's stored title/icon while the bound conversation is still loading. */
  preserveVisuals?: boolean
}

/**
 * Sync this tab's own title / icon into the tab model. Presentation only — the
 * tab's navigation identity lives in its URL. The owning page passes its
 * derived visuals; everything tab-specific (emoji → icon descriptor mapping,
 * which tab id, change dedupe) stays here so the page never touches the tab
 * system or the `Tab` shape. No-op without a TabsProvider / TabIdProvider
 * (tests, detached popups).
 */
export function useTabSelfVisuals({
  title,
  emoji,
  icon: imageIcon,
  routePrefix,
  preserveVisuals = false
}: TabSelfVisuals): void {
  const currentTabId = useCurrentTabId()
  const tabsContext = useOptionalTabsContext()
  const updateTab = tabsContext?.updateTab
  const currentTab = tabsContext?.tabs.find((tab) => tab.id === currentTabId)

  useEffect(() => {
    if (!currentTabId || !updateTab || !currentTab) return
    if (preserveVisuals) return
    if (
      routePrefix &&
      currentTab.url !== routePrefix &&
      !currentTab.url.startsWith(`${routePrefix}?`) &&
      !currentTab.url.startsWith(`${routePrefix}/`)
    )
      return
    const icon = imageIcon ?? emojiTabIcon(emoji)
    if (currentTab.title === title && currentTab.icon === icon) return
    updateTab(currentTabId, { title, icon })
  }, [currentTabId, currentTab, updateTab, title, emoji, imageIcon, routePrefix, preserveVisuals])
}
