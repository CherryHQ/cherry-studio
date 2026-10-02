import { useEffect } from 'react'

import type { ConversationAppId } from '@renderer/types/conversation'
import { findConversationTabIds } from '@renderer/utils/conversationNavigation'
import { emojiTabIcon } from '@renderer/utils/tabIcons'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { useCurrentTabId } from './useCurrentTab'
import { useOptionalTabsContext } from './useTabsContext'

const EMPTY_TABS: readonly Tab[] = []

export interface TabSelfVisuals {
  title: string
  emoji?: string | null
  icon?: string
  /** Only stamp while the current tab URL belongs to this caller-supplied route prefix. */
  routePrefix?: string
  /** Keep the tab's stored title/icon while the bound conversation is still loading. */
  preserveVisuals?: boolean
  /**
   * Conversation these visuals describe. When set, every tab bound to it is stamped, not
   * just the owning one — sibling tabs whose page is hidden or dormant cannot derive the
   * title themselves, so a rename would otherwise strand them on the old name.
   */
  conversation?: { appId: ConversationAppId; key: string }
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
  preserveVisuals = false,
  conversation
}: TabSelfVisuals): void {
  const currentTabId = useCurrentTabId()
  const tabsContext = useOptionalTabsContext()
  const updateTab = tabsContext?.updateTab
  const tabs = tabsContext?.tabs ?? EMPTY_TABS
  const currentTab = tabs.find((tab) => tab.id === currentTabId)
  const conversationAppId = conversation?.appId
  const conversationKey = conversation?.key

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
    // The owning tab is always included: its URL can still lag a just-committed
    // conversation selection, which the key-based match below cannot see yet.
    const targetIds = new Set([currentTabId])
    if (conversationAppId && conversationKey) {
      for (const tabId of findConversationTabIds(tabs, conversationAppId, conversationKey)) targetIds.add(tabId)
    }
    for (const tab of tabs) {
      if (!targetIds.has(tab.id)) continue
      if (tab.title === title && tab.icon === icon) continue
      updateTab(tab.id, { title, icon })
    }
  }, [
    conversationAppId,
    conversationKey,
    currentTabId,
    currentTab,
    tabs,
    updateTab,
    title,
    emoji,
    imageIcon,
    routePrefix,
    preserveVisuals
  ])
}
