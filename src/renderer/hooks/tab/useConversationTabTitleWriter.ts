import { useCallback, useEffect, useRef } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useDataChange } from '@renderer/data/hooks/useDataApi'
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
  // A delayed read-back must match against the tabs as they are when it lands,
  // not as they were when the rename was observed.
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  // An unmounted writer's snapshot never advances again, so its delayed writes
  // would stamp stale bindings over whatever the tab now shows.
  const mountedRef = useRef(true)
  useEffect(() => () => (mountedRef.current = false), [])

  return useCallback(
    (kind: ConversationTabKind, conversationId: string, name: string | null | undefined) => {
      const title = name?.trim()
      if (!mountedRef.current || !updateTab || !tabsRef.current || !title) return
      const param = CONVERSATION_PARAM[kind]
      for (const tab of tabsRef.current) {
        if (tab.title === title) continue
        if (boundConversationId(tab, param) === conversationId) updateTab(tab.id, { title })
      }
    },
    [updateTab]
  )
}

/** The read model each conversation kind is looked up in. */
const CONVERSATION_ENDPOINT = {
  topic: '/topics/:id',
  session: '/agent-sessions/:sessionId'
} as const

/**
 * Follow a rename made in **another** window.
 *
 * The manual and automatic rename paths relabel tabs in the window that made the
 * change. A rename made in a detached window only reaches this one as a DataApi
 * change notification, which refreshes lists but carries no name — so read the row
 * back for the conversations this window has bound to a tab and relabel those.
 */
export function useConversationTabTitleChangeSync() {
  const writeConversationTabTitle = useConversationTabTitleWriter()
  const context = useOptionalTabsContext()
  const tabs = context?.tabs

  useDataChange([CONVERSATION_ENDPOINT.topic, CONVERSATION_ENDPOINT.session], (effects) => {
    if (!tabs) return
    const bound = {
      topic: new Set(tabs.map((tab) => boundConversationId(tab, CONVERSATION_PARAM.topic))),
      session: new Set(tabs.map((tab) => boundConversationId(tab, CONVERSATION_PARAM.session)))
    }
    for (const effect of effects) {
      const kind = effect.endpoint === CONVERSATION_ENDPOINT.topic ? 'topic' : 'session'
      for (const id of effect.entityIds ?? []) {
        if (!id || !bound[kind].has(id)) continue
        if (kind === 'topic') {
          void dataApiService
            .get(`/topics/${id}`)
            .then((row) => writeConversationTabTitle('topic', id, row.name))
            .catch(() => {
              // A row that vanished under the change needs no label.
            })
        } else {
          void dataApiService
            .get(`/agent-sessions/${id}`)
            .then((row) => writeConversationTabTitle('session', id, row.name))
            .catch(() => {
              // A row that vanished under the change needs no label.
            })
        }
      }
    }
  })
}
