import type { ConversationAppId } from '@renderer/types/conversation'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import { useCallback } from 'react'

import { useOptionalTabsContext } from './useTabsContext'

export function useCloseConversationTabs() {
  const tabsContext = useOptionalTabsContext()

  return useCallback(
    (appId: ConversationAppId, keys: readonly string[]) => {
      if (!tabsContext || keys.length === 0) return

      const app = getSidebarApp(appId)
      if (!app?.conversationRoute) return

      const keySet = new Set(keys)
      const tabIds: string[] = []
      for (const tab of tabsContext.tabs) {
        if (tab.id === tabsContext.activeTabId) continue
        if (tab.type !== 'route' || !tabBelongsToApp(app, tab.url)) continue

        const key = app.conversationRoute.keyFromUrl(tab.url)
        if (key && keySet.has(key)) {
          tabIds.push(tab.id)
        }
      }

      tabsContext.closeTabs(tabIds)
    },
    [tabsContext]
  )
}
