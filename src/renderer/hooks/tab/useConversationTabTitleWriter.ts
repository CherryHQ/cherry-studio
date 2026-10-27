import { useCallback } from 'react'

import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { useOptionalTabsContext } from './useTabsContext'

const BASE_URL = 'https://www.cherry-ai.com/'

/** Query parameter carrying a Chat / Work tab's conversation id. */
const CONVERSATION_PARAM = { topic: 'topicId', session: 'sessionId' } as const

function boundConversationId(tab: Tab, param: string): string | null {
  if (tab.type !== 'route') return null
  try {
    return new URL(tab.url, BASE_URL).searchParams.get(param) || null
  } catch {
    return null
  }
}

export type ConversationTabKind = keyof typeof CONVERSATION_PARAM

/**
 * Mirror a conversation rename into every tab bound to it.
 *
 * Chat / Work tab labels come from the owning page, which only runs while its tab
 * is awake — a conversation renamed from another tab's list would leave this tab's
 * label stale until it is activated. Rename writers call this so the label follows
 * the data immediately, wherever the rename was made. No-op outside a TabsProvider,
 * and for a blank name (the page's own assistant/agent fallback owns that case).
 */
export function useConversationTabTitleWriter() {
  const context = useOptionalTabsContext()
  const updateTab = context?.updateTab
  const tabs = context?.tabs

  return useCallback(
    (kind: ConversationTabKind, conversationId: string, name: string | null | undefined) => {
      const title = name?.trim()
      if (!updateTab || !tabs || !title) return
      const param = CONVERSATION_PARAM[kind]
      for (const tab of tabs) {
        if (tab.title === title) continue
        if (boundConversationId(tab, param) === conversationId) updateTab(tab.id, { title })
      }
    },
    [tabs, updateTab]
  )
}
