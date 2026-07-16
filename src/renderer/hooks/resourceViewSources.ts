import { dataApiService } from '@renderer/data/DataApiService'
import type { AgentSessionListItem } from '@shared/data/api/schemas/agentSessions'
import type { TopicListItem } from '@shared/data/api/schemas/topics'
import { useCallback } from 'react'

import { useAgentSessionStats } from './agent/useSession'
import { useTopicStats } from './useTopic'

/**
 * Page-level resource facts and bounded seed lookups shared by classic rails,
 * conversation pages, and their right-panel lists.
 */

const RESOURCE_REUSE_CANDIDATE_PAGE_SIZE = 50

/**
 * Factual counts drive group visibility. Imperative lookups use scoped latest
 * for owner navigation and bounded pages for placeholder reuse.
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
  const loadTopicReuseCandidates = useCallback(async (assistantId: string | null): Promise<TopicListItem[]> => {
    const query = {
      assistantId: assistantId ?? 'unlinked',
      limit: RESOURCE_REUSE_CANDIDATE_PAGE_SIZE,
      sortBy: 'orderKey' as const
    }
    const [pinnedPage, ordinaryPage] = await Promise.all([
      dataApiService.get('/topics', { query: { ...query, pinned: true } }),
      dataApiService.get('/topics', { query: { ...query, pinned: false } })
    ])
    const pinnedIds = new Set(pinnedPage.items.map((topic) => topic.id))
    return [...pinnedPage.items, ...ordinaryPage.items.filter((topic) => !pinnedIds.has(topic.id))]
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    refetchStats: statsSource.refetch,
    loadLatestTopic,
    loadTopicReuseCandidates
  }
}

/** Session counterpart to {@link useAssistantTopicsSource}. */
export function useAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useAgentSessionStats({ enabled })
  const loadLatestSession = useCallback(async (agentId?: string) => {
    const result =
      agentId === undefined
        ? await dataApiService.get('/agent-sessions/latest')
        : await dataApiService.get('/agent-sessions/latest', { query: { agentId } })
    return result.session
  }, [])
  const loadSessionReuseCandidates = useCallback(async (agentId: string): Promise<AgentSessionListItem[]> => {
    const query = { agentId, limit: RESOURCE_REUSE_CANDIDATE_PAGE_SIZE, sortBy: 'orderKey' as const }
    const [pinnedPage, ordinaryPage] = await Promise.all([
      dataApiService.get('/agent-sessions', { query: { ...query, pinned: true } }),
      dataApiService.get('/agent-sessions', { query: { ...query, pinned: false } })
    ])
    const pinnedIds = new Set(pinnedPage.items.map((session) => session.id))
    return [...pinnedPage.items, ...ordinaryPage.items.filter((session) => !pinnedIds.has(session.id))]
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    refetchStats: statsSource.refetch,
    loadLatestSession,
    loadSessionReuseCandidates
  }
}

export type AssistantTopicsSource = ReturnType<typeof useAssistantTopicsSource>
export type AgentSessionsSource = ReturnType<typeof useAgentSessionsSource>
