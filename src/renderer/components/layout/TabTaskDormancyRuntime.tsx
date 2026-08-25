import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { classifyTurn } from '@shared/ai/transport'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { useEffect, useMemo } from 'react'

const INACTIVE_TOPIC_ID = '__inactive_workspace__'

function getConversationTopicId(url: string): string | undefined {
  try {
    const parsed = new URL(url, 'app://cherry')
    if (parsed.searchParams.get('view') === 'message') return undefined
    if (parsed.pathname === '/app/chat') return parsed.searchParams.get('topicId') ?? undefined
    if (parsed.pathname === '/app/agents') {
      const sessionId = parsed.searchParams.get('sessionId')
      return sessionId ? buildAgentSessionTopicId(sessionId) : undefined
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Keeps live/approval tabs out of LRU dormancy without coupling page lifetime to task lifetime. */
export function TabTaskDormancyRuntime({
  tab,
  updateTab
}: {
  tab: Tab
  updateTab: (id: string, updates: Partial<Tab>) => void
}): null {
  const topicId = useMemo(() => getConversationTopicId(tab.url), [tab.url])
  const statusEntry = useSharedCacheValue(`topic.stream.statuses.${topicId ?? INACTIVE_TOPIC_ID}` as const)
  const flags = classifyTurn(statusEntry?.status)
  const preventDormancy = flags.isTurnActive || (statusEntry?.awaitingApprovalAnchors.length ?? 0) > 0

  useEffect(() => {
    if (Boolean(tab.metadata?.preventDormancy) === preventDormancy) return
    updateTab(tab.id, { metadata: { ...tab.metadata, preventDormancy } })
  }, [preventDormancy, tab.id, tab.metadata, updateTab])

  return null
}
