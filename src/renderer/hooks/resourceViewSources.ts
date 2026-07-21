import { dataApiService } from '@renderer/data/DataApiService'
import type { AgentSessionWorkspaceScope } from '@shared/data/api/schemas/agentSessions'
import { useCallback } from 'react'

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
export function useAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
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

/** Session counterpart to {@link useAssistantTopicsSource}. */
export function useAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useAgentSessionStats({ enabled })
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
    loadLatestSession,
    loadReusableSessions
  }
}

export type AssistantTopicsSource = ReturnType<typeof useAssistantTopicsSource>
export type AgentSessionsSource = ReturnType<typeof useAgentSessionsSource>
