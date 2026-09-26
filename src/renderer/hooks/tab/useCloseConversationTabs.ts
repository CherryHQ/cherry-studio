import { createContext, use } from 'react'

import type { ConversationAppId } from '@renderer/types/conversation'
import { findConversationTabIds } from '@renderer/utils/conversationNavigation'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

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

  return keys.flatMap((key) => findConversationTabIds(tabs, appId, key)).filter((tabId) => tabId !== activeTabId)
}

export function useCloseConversationTabs(): CloseConversationTabs {
  return use(CloseConversationTabsContext) ?? closeNoConversationTabs
}
