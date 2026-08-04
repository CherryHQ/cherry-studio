import { isPageTitledRoute } from '@renderer/utils/routeTitle'
import { emojiTabIcon } from '@renderer/utils/tabIcons'
import { buildTabInstanceMetadata } from '@renderer/utils/tabInstanceMetadata'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { TabInstanceAppId } from '@shared/types/tabInstanceMetadata'
import { useEffect } from 'react'

import { useCurrentTabId } from './useCurrentTab'
import { useOptionalTabsContext } from './useTabsContext'

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
