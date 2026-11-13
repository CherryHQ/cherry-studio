import { useEffect, useRef } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useDataChange, useWriteCache } from '@renderer/data/hooks/useDataApi'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { isEmoji } from '@renderer/utils/naming'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import { emojiTabIcon } from '@renderer/utils/tabIcons'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

function boundSessionId(tab: Tab): string | undefined {
  const app = getSidebarApp('agents')
  if (tab.type !== 'route' || !app?.conversationRoute || !tabBelongsToApp(app, tab.url)) return undefined
  return app.conversationRoute.keyFromUrl(tab.url)
}

/** Keep bound Work tab icons current while their pages are hidden or dormant. */
export function useAgentTabIconChangeSync(): void {
  const context = useOptionalTabsContext()
  const writeCache = useWriteCache()
  const contextRef = useRef(context)
  contextRef.current = context
  const lifecycle = useRef({ mounted: false, revision: 0 }).current

  useEffect(() => {
    lifecycle.mounted = true
    return () => {
      lifecycle.mounted = false
      lifecycle.revision++
    }
  }, [lifecycle])

  useDataChange('/agents/:agentId', () => {
    const revision = ++lifecycle.revision
    const sessionIds = new Set(contextRef.current?.tabs.map(boundSessionId).filter((id) => id !== undefined))
    const agents = new Map<string, Promise<AgentEntity>>()
    // Refresh every binding: a later batch supersedes all pending reads, even for another agent.
    for (const sessionId of sessionIds) {
      void dataApiService
        .get(`/agent-sessions/${sessionId}`)
        .then(async (session) => {
          if (!session.agentId) return
          let agent = agents.get(session.agentId)
          if (!agent) {
            const path = `/agents/${session.agentId}` as const
            agent = dataApiService.get(path).then(async (row) => {
              if (lifecycle.mounted && lifecycle.revision === revision) {
                // Resumed pages must read the same avatar instead of restoring their cached icon.
                await writeCache(path, row)
              }
              return row
            })
            agents.set(session.agentId, agent)
          }
          const avatar = (await agent).configuration?.avatar || undefined
          const icon = avatar && isEmoji(avatar) ? emojiTabIcon(avatar) : avatar
          const latest = contextRef.current
          if (!lifecycle.mounted || lifecycle.revision !== revision || !latest) return
          for (const tab of latest.tabs) {
            if (boundSessionId(tab) === sessionId && tab.icon !== icon) latest.updateTab(tab.id, { icon })
          }
        })
        .catch(() => {
          // Missing sessions/agents must not prevent other bound tabs from refreshing.
        })
    }
  })
}
