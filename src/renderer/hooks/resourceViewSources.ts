import { dataApiService } from '@renderer/data/DataApiService'
import { AGENT_SESSION_DELETE_MAX_IDS } from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { createContext, use, useCallback } from 'react'

import { useAgentSessionStats } from './agent/useSession'
import { useTopicStats } from './useTopic'

/**
 * Page-level resource facts and exact derived lookups shared by classic rails,
 * conversation pages, and their right-panel lists.
 */

/**
 * Factual counts drive group visibility. Imperative lookups use scoped latest
 * for owner navigation and domain reads for placeholder reuse.
 */
export function useRawAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useTopicStats({ enabled })
  const loadLatestTopic = useCallback(async (assistantId?: string | null) => {
    const result =
      assistantId === undefined
        ? await dataApiService.get('/topics/latest')
        : await dataApiService.get('/topics/latest', { query: { assistantId: assistantId ?? 'unlinked' } })
    return result.topic
  }, [])
  const reuseOrCreateTopic = useCallback(async (assistantId: string | null, excludeTopicId?: string) => {
    return dataApiService.post('/topics/reusable-placeholder', {
      body: { assistantId, ...(excludeTopicId ? { excludeTopicId } : {}) }
    })
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    loadLatestTopic,
    reuseOrCreateTopic
  }
}

/** Session counterpart to {@link useRawAssistantTopicsSource}. */
export function useRawAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useAgentSessionStats({ enabled })
  const loadSession = useCallback((sessionId: string) => dataApiService.get(`/agent-sessions/${sessionId}`), [])
  const loadLatestSession = useCallback(async (agentId?: string | null) => {
    const result =
      agentId === undefined
        ? await dataApiService.get('/agent-sessions/latest')
        : await dataApiService.get('/agent-sessions/latest', { query: { agentId: agentId ?? 'unlinked' } })
    return result.session
  }, [])
  const reuseOrCreateSession = useCallback(
    async (agentId: string, workspace: AgentSessionWorkspaceSource, excludeSessionId?: string) => {
      return dataApiService.post('/agent-sessions/reusable-placeholders', {
        body: { agentId, workspace, ...(excludeSessionId ? { excludeSessionId } : {}) }
      })
    },
    []
  )
  const loadSessionIds = useCallback(async (agentId: string) => {
    const ids: string[] = []

    for (const pinned of [true, false] as const) {
      let cursor: string | undefined
      do {
        const page = await dataApiService.get('/agent-sessions', {
          query: {
            agentId,
            pinned,
            limit: AGENT_SESSION_DELETE_MAX_IDS,
            ...(cursor ? { cursor } : {})
          }
        })
        ids.push(...page.items.map((session) => session.id))
        cursor = page.nextCursor
      } while (cursor)
    }

    return ids
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    refetchStats: statsSource.refetch,
    loadSession,
    loadLatestSession,
    reuseOrCreateSession,
    loadSessionIds
  }
}

export type AssistantTopicsSource = ReturnType<typeof useRawAssistantTopicsSource>
export type AgentSessionsSource = ReturnType<typeof useRawAgentSessionsSource>

export const AssistantTopicsSourceContext = createContext<AssistantTopicsSource | null>(null)
export const AgentSessionsSourceContext = createContext<AgentSessionsSource | null>(null)

export function useAssistantTopicsSource(): AssistantTopicsSource {
  const source = use(AssistantTopicsSourceContext)
  if (!source) throw new Error('useAssistantTopicsSource must be used within ResourceViewSourceProvider')
  return source
}

export function useAgentSessionsSource(): AgentSessionsSource {
  const source = use(AgentSessionsSourceContext)
  if (!source) throw new Error('useAgentSessionsSource must be used within ResourceViewSourceProvider')
  return source
}
