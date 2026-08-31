import type { ConversationAppId } from '@renderer/types/conversation'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createContext, use } from 'react'

export type CloseConversationTabs = (appId: ConversationAppId, keys: readonly string[]) => void

const closeNoConversationTabs: CloseConversationTabs = () => {}

export const CloseConversationTabsContext = createContext<CloseConversationTabs | null>(null)

export function findClosableConversationTabIds(
  tabs: readonly Tab[],
  activeTabId: string,
  appId: ConversationAppId,
  keys: readonly string[]
): string[] {
  if (keys.length === 0) return []

  const app = getSidebarApp(appId)
  if (!app?.conversationRoute) return []

  const keySet = new Set(keys)
  const tabIds: string[] = []
  for (const tab of tabs) {
    if (tab.id === activeTabId) continue
    if (tab.type !== 'route' || !tabBelongsToApp(app, tab.url)) continue

    const key = app.conversationRoute.keyFromUrl(tab.url)
    if (key && keySet.has(key)) {
      tabIds.push(tab.id)
    }
  }

  return tabIds
}

export function useCloseConversationTabs(): CloseConversationTabs {
  return use(CloseConversationTabsContext) ?? closeNoConversationTabs
}
