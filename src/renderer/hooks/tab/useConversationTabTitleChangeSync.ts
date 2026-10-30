import { useEffect, useRef } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useDataChange } from '@renderer/data/hooks/useDataApi'
import type { ConversationAppId } from '@renderer/types/conversation'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { useOptionalTabsContext } from './useTabsContext'

/** The read model holding each conversation app's conversation names. */
const NAME_ENDPOINT = {
  assistants: '/topics/:id',
  agents: '/agent-sessions/:sessionId'
} as const satisfies Record<ConversationAppId, string>

const CONVERSATION_APP_IDS = Object.keys(NAME_ENDPOINT) as ConversationAppId[]

function readConversationName(appId: ConversationAppId, id: string): Promise<{ name?: string | null }> {
  return appId === 'assistants' ? dataApiService.get(`/topics/${id}`) : dataApiService.get(`/agent-sessions/${id}`)
}

function boundConversationKey(tab: Tab, appId: ConversationAppId): string | undefined {
  const app = getSidebarApp(appId)
  if (tab.type !== 'route' || !app?.conversationRoute || !tabBelongsToApp(app, tab.url)) return undefined
  return app.conversationRoute.keyFromUrl(tab.url)
}

/**
 * Relabel bound Chat / Work tabs after any rename — manual or automatic, from this window or another.
 *
 * Tab labels come from the owning page, which only runs while its tab is awake. Every
 * committed rename reaches every window as a DataApi change notification, which carries
 * no name — so read the row back for the conversations this window has bound to a tab
 * and relabel those. A blank name is skipped (the page's assistant/agent fallback owns it).
 */
export function useConversationTabTitleChangeSync() {
  // Delayed read-backs must match against the tabs as they are when they land.
  const context = useOptionalTabsContext()
  const contextRef = useRef(context)
  contextRef.current = context
  // An unmounted sync's snapshot never advances again, so its delayed writes would
  // stamp stale bindings over whatever the tab now shows.
  const mountedRef = useRef(true)
  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])
  // Read-backs for one conversation may resolve out of order; only the latest-issued
  // one is guaranteed to see the newest committed name.
  const latestReadRef = useRef(new Map<string, number>())

  const relabel = (appId: ConversationAppId, id: string, name: string | null | undefined) => {
    const title = name?.trim()
    const context = contextRef.current
    if (!mountedRef.current || !context || !title) return
    for (const tab of context.tabs) {
      if (tab.title !== title && boundConversationKey(tab, appId) === id) context.updateTab(tab.id, { title })
    }
  }

  useDataChange(Object.values(NAME_ENDPOINT), (effects) => {
    const tabs = contextRef.current?.tabs
    if (!tabs) return
    for (const effect of effects) {
      const appId = CONVERSATION_APP_IDS.find((candidate) => NAME_ENDPOINT[candidate] === effect.endpoint)
      if (!appId) continue
      const bound = new Set(tabs.map((tab) => boundConversationKey(tab, appId)))
      for (const id of effect.entityIds ?? []) {
        if (!id || !bound.has(id)) continue
        const key = `${appId}:${id}`
        const seq = (latestReadRef.current.get(key) ?? 0) + 1
        latestReadRef.current.set(key, seq)
        void readConversationName(appId, id)
          .then((row) => {
            if (latestReadRef.current.get(key) === seq) relabel(appId, id, row.name)
          })
          .catch(() => {
            // A row that vanished under the change needs no label.
          })
      }
    }
  })
}
