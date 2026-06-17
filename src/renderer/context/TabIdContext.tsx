import { emojiTabIcon } from '@renderer/components/layout/tabIcons'
import { buildTabInstanceMetadata } from '@renderer/config/tabInstanceMetadata'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import { isPageTitledRoute } from '@renderer/utils/routeTitle'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { TabInstanceAppId } from '@shared/types/tabInstanceMetadata'
import { createContext, type ReactNode, use, useEffect } from 'react'

/**
 * Provides the id of the tab that owns the content rendered beneath it.
 *
 * All non-dormant tabs mount simultaneously (React 19 `Activity` keep-alive in
 * {@link import('../components/layout/TabRouter').TabRouter}), so a page cannot
 * rely on `useTabs().activeTab` to identify itself — that points at the globally
 * active tab. A page reads its OWN id from here.
 */
const TabIdContext = createContext<string | null>(null)

export function TabIdProvider({ tabId, children }: { tabId: string; children: ReactNode }) {
  return <TabIdContext value={tabId}>{children}</TabIdContext>
}

/** The owning tab's id, or null when rendered outside a tab (e.g. tests). */
export function useCurrentTabId(): string | null {
  return use(TabIdContext)
}

export function useCurrentTab(): Tab | undefined {
  const currentTabId = useCurrentTabId()
  return useOptionalTabsContext()?.tabs.find((tab) => tab.id === currentTabId)
}

export interface TabSelfMetadata {
  title: string
  emoji?: string | null
  instanceAppId?: TabInstanceAppId
  instanceKey?: string | null
}

const TAB_INSTANCE_ROUTE_PREFIX: Record<TabInstanceAppId, string> = {
  assistants: '/app/chat',
  agents: '/app/agents'
}

function tabBelongsToInstanceApp(tab: Pick<Tab, 'url'>, appId: TabInstanceAppId): boolean {
  const routePrefix = TAB_INSTANCE_ROUTE_PREFIX[appId]
  return tab.url === routePrefix || tab.url.startsWith(`${routePrefix}?`) || tab.url.startsWith(`${routePrefix}/`)
}

function isMetadataEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

/**
 * Sync this tab's own title / icon / instance key into the tab model.
 * The owning page passes its derived metadata; everything tab-specific
 * (emoji → icon descriptor mapping, which tab id, change dedupe) stays here so
 * the page never touches the tab system or the
 * `Tab` shape. No-op without a TabsProvider / TabIdProvider (tests, detached popups).
 */
export function useTabSelfMetadata({ title, emoji, instanceAppId, instanceKey }: TabSelfMetadata): void {
  const currentTabId = useCurrentTabId()
  const tabsContext = useOptionalTabsContext()
  const updateTab = tabsContext?.updateTab
  const currentTab = tabsContext?.tabs.find((tab) => tab.id === currentTabId)

  useEffect(() => {
    if (!currentTabId || !updateTab || !currentTab) return
    if (instanceAppId && !tabBelongsToInstanceApp(currentTab, instanceAppId)) return
    const icon = emojiTabIcon(emoji)
    const metadata = buildTabInstanceMetadata(currentTab.metadata, {
      appId: instanceAppId,
      key: instanceKey
    })
    if (currentTab.id === 'home' && !isPageTitledRoute(currentTab.url)) {
      if (isMetadataEqual(currentTab.metadata, metadata)) return
      updateTab(currentTabId, { metadata })
      return
    }

    if (currentTab.title === title && currentTab.icon === icon && isMetadataEqual(currentTab.metadata, metadata)) {
      return
    }
    updateTab(currentTabId, {
      title,
      icon,
      metadata
    })
  }, [currentTabId, currentTab, updateTab, title, emoji, instanceAppId, instanceKey])
}

/**
 * True when this tab is the globally-focused one. Gates "last used" writes so background
 * tabs (also mounted under keep-alive) don't clobber the single global value.
 */
export function useIsActiveTab(): boolean {
  const currentTabId = useCurrentTabId()
  const activeTabId = useOptionalTabsContext()?.activeTabId
  return !!currentTabId && currentTabId === activeTabId
}
