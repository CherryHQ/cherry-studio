import { dataApiService } from '@renderer/data/DataApiService'
import type { AgentSessionWorkspaceScope } from '@shared/data/api/schemas/agentSessions'
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
  const loadReusableTopic = useCallback(async (assistantId: string | null) => {
    const result = await dataApiService.get('/topics/reusable-placeholder', {
      query: { assistantId: assistantId ?? 'unassigned' }
    })
    return result.topic
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    refetchStats: statsSource.refetch,
    loadLatestTopic,
    loadReusableTopic
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
  const loadReusableSessions = useCallback(async (agentId: string, workspaceId?: AgentSessionWorkspaceScope) => {
    const result = await dataApiService.get('/agent-sessions/reusable-placeholders', {
      query: { agentId, ...(workspaceId ? { workspaceId } : {}) }
    })
    return result.sessions
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    refetchStats: statsSource.refetch,
    loadSession,
    loadLatestSession,
    loadReusableSessions
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
