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
 * label stale until it is activated. No-op outside a TabsProvider, and for a blank
 * name (the page's own assistant/agent fallback owns that case).
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
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

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
 * Relabel bound tabs after any rename — manual or automatic, from this window or another.
 *
 * Every committed rename reaches every window as a DataApi change notification, which
 * carries no name — so read the row back for the conversations this window has bound
 * to a tab and relabel those. Reading back (rather than trusting a rename's requested
 * name) keeps overlapping renames from landing an older name over a newer one.
 */
export function useConversationTabTitleChangeSync() {
  const writeConversationTabTitle = useConversationTabTitleWriter()
  const context = useOptionalTabsContext()
  const tabs = context?.tabs
  // Read-backs for one conversation may resolve out of order; only the latest-issued
  // one is guaranteed to see the newest committed name.
  const latestReadRef = useRef(new Map<string, number>())

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
        const key = `${kind}:${id}`
        const seq = (latestReadRef.current.get(key) ?? 0) + 1
        latestReadRef.current.set(key, seq)
        const read: Promise<{ name?: string | null }> =
          kind === 'topic' ? dataApiService.get(`/topics/${id}`) : dataApiService.get(`/agent-sessions/${id}`)
        void read
          .then((row) => {
            if (latestReadRef.current.get(key) === seq) writeConversationTabTitle(kind, id, row.name)
          })
          .catch(() => {
            // A row that vanished under the change needs no label.
          })
      }
    }
  })
}
