import { getSidebarApp, getSidebarAppTabInstanceKey, type SidebarAppId, tabBelongsToApp } from '@renderer/utils/sidebar'
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
      for (const tab of tabsContext.tabs) {
        if (tab.type !== 'route' || !tabBelongsToApp(app, tab.url)) continue

        const key = getSidebarAppTabInstanceKey(app, tab)
        if (key && keySet.has(key)) {
          tabsContext.closeTab(tab.id)
        }
      }
    },
    [tabsContext]
  )
}
