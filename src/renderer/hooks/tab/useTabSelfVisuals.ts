import type { ConversationAppId } from '@renderer/types/conversation'
import { emojiTabIcon } from '@renderer/utils/tabIcons'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { useEffect, useRef } from 'react'

import { useCurrentTabId } from './useCurrentTab'
import { useOptionalTabsContext } from './useTabsContext'

export interface TabSelfVisuals {
  title: string
  emoji?: string | null
  /** Route-ownership guard: only stamp while the tab is on this app's routes. */
  appId?: ConversationAppId
  /** Keep the tab's stored title/icon while the bound conversation is still loading. */
  preserveVisuals?: boolean
  /**
   * The assistant / agent this tab is currently showing. Stamped alongside the
   * visuals so the sidebar can tell which of its pinned entities are open: the
   * route rewrites `assistantId` / `agentId` to a topic / session id, so the URL
   * alone cannot answer that. Re-stamped on every switch, because a tab that
   * navigates to another entity no longer belongs to the one it was opened from.
   */
  entityId?: string
}

const TAB_APP_ROUTE_PREFIX: Record<ConversationAppId, string> = {
  assistants: '/app/chat',
  agents: '/app/agents'
}

const CONVERSATION_ENTRY_TYPE: Record<ConversationAppId, 'assistant' | 'agent'> = {
  assistants: 'assistant',
  agents: 'agent'
}

function sameConversationEntry(tab: Pick<Tab, 'metadata'>, entry: { type: string; entityId: string } | undefined) {
  const stamped = tab.metadata?.conversationEntry as { type?: string; entityId?: string } | undefined
  return stamped?.type === entry?.type && stamped?.entityId === entry?.entityId
}

function tabBelongsToApp(tab: Pick<Tab, 'url'>, appId: ConversationAppId): boolean {
  const routePrefix = TAB_APP_ROUTE_PREFIX[appId]
  return tab.url === routePrefix || tab.url.startsWith(`${routePrefix}?`) || tab.url.startsWith(`${routePrefix}/`)
}

/**
 * Sync this tab's own title / icon and owning entity into the tab model. The
 * owning page passes its derived visuals; everything tab-specific (emoji → icon
 * descriptor mapping, which tab id, change dedupe) stays here so the page never
 * touches the tab system or the `Tab` shape. No-op without a TabsProvider /
 * TabIdProvider (tests, detached popups).
 */
export function useTabSelfVisuals({ title, emoji, appId, preserveVisuals = false, entityId }: TabSelfVisuals): void {
  const currentTabId = useCurrentTabId()
  const tabsContext = useOptionalTabsContext()
  const currentTab = tabsContext?.tabs.find((tab) => tab.id === currentTabId)

  // The stored values this hook compares against, as primitives: depending on the
  // tab object itself would re-run the effect for every unrelated field (LRU
  // timestamps, dormancy) that the tab system writes.
  const storedTitle = currentTab?.title
  const storedIcon = currentTab?.icon
  const storedUrl = currentTab?.url
  const storedMetadata = currentTab?.metadata

  // `updateTab` is rebuilt whenever the tab list changes, so holding it in a ref
  // keeps every tab mutation in the window out of this effect's dependencies.
  const updateTabRef = useRef(tabsContext?.updateTab)
  updateTabRef.current = tabsContext?.updateTab

  useEffect(() => {
    const updateTab = updateTabRef.current
    if (!currentTabId || !updateTab || storedUrl === undefined) return
    if (preserveVisuals) return
    if (appId && !tabBelongsToApp({ url: storedUrl }, appId)) return
    const icon = emojiTabIcon(emoji)
    const entry = appId && entityId ? { type: CONVERSATION_ENTRY_TYPE[appId], entityId } : undefined
    const visualsUnchanged = storedTitle === title && storedIcon === icon
    if (visualsUnchanged && sameConversationEntry({ metadata: storedMetadata }, entry)) return
    updateTab(currentTabId, { title, icon, metadata: { ...storedMetadata, conversationEntry: entry } })
  }, [currentTabId, storedTitle, storedIcon, storedUrl, storedMetadata, title, emoji, appId, preserveVisuals, entityId])
}
