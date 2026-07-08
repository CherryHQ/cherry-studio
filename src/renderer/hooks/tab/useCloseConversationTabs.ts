import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import { getSidebarApp, getSidebarAppTabInstanceKey, type SidebarAppId, tabBelongsToApp } from '@renderer/utils/sidebar'
import { clearTabInstanceMetadata } from '@renderer/utils/tabInstanceMetadata'
import { useCallback } from 'react'

import { useOptionalTabsContext } from './useTabsContext'

type ConversationTabAppId = Extract<SidebarAppId, 'assistants' | 'agents'>

export function useCloseConversationTabs() {
  const tabsContext = useOptionalTabsContext()

  return useCallback(
    (appId: ConversationTabAppId, keys: readonly string[]) => {
      if (!tabsContext || keys.length === 0) return

      const app = getSidebarApp(appId)
      if (!app?.instanceKey) return

      const keySet = new Set(keys)
      const appTabs: typeof tabsContext.tabs = []
      const matchingTabs: typeof tabsContext.tabs = []
      for (const tab of tabsContext.tabs) {
        if (tab.type !== 'route' || !tabBelongsToApp(app, tab.url)) continue

        appTabs.push(tab)
        const key = getSidebarAppTabInstanceKey(app, tab)
        if (key && keySet.has(key)) {
          matchingTabs.push(tab)
        }
      }
      if (matchingTabs.length === 0) return

      const activeMatchingTab = matchingTabs.find((tab) => tab.id === tabsContext.activeTabId)
      if (activeMatchingTab || matchingTabs.length === appTabs.length) {
        const fallbackTab = activeMatchingTab ?? matchingTabs[0]
        tabsContext.updateTab(fallbackTab.id, {
          url: app.routePrefix,
          title: getDefaultRouteTitle(app.routePrefix),
          icon: undefined,
          metadata: clearTabInstanceMetadata(fallbackTab.metadata)
        })

        const remainingTabIds = matchingTabs.filter((tab) => tab.id !== fallbackTab.id).map((tab) => tab.id)
        if (remainingTabIds.length > 0) {
          tabsContext.closeTabs(remainingTabIds)
        }
        return
      }

      tabsContext.closeTabs(matchingTabs.map((tab) => tab.id))
    },
    [tabsContext]
  )
}
