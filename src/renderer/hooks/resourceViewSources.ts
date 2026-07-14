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

const RESOURCE_SEED_PAGE_SIZE = 50

/**
 * Factual counts drive group visibility. Imperative lookups fetch one bounded
 * page for rail navigation and placeholder reuse.
 */
export function useAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useTopicStats({ enabled })
  const loadFirstTopic = useCallback(async (assistantId: string | null): Promise<TopicListItem | null> => {
    const page = await dataApiService.get('/topics', {
      query: {
        assistantId: assistantId ?? 'unlinked',
        limit: 1,
        sortBy: 'updatedAt'
      }
    })
    return page.items[0] ?? null
  }, [])
  const loadLatestTopic = useCallback(async () => {
    const result = await dataApiService.get('/topics/latest')
    return result.topic
  }, [])
  const loadTopicSeedCandidates = useCallback(async (assistantId: string | null): Promise<TopicListItem[]> => {
    const page = await dataApiService.get('/topics', {
      query: {
        assistantId: assistantId ?? 'unlinked',
        limit: RESOURCE_SEED_PAGE_SIZE,
        sortBy: 'orderKey'
      }
    })
    return page.items
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    refetchStats: statsSource.refetch,
    loadFirstTopic,
    loadLatestTopic,
    loadTopicSeedCandidates
  }
}

/** Session counterpart to {@link useAssistantTopicsSource}. */
export function useAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useAgentSessionStats({ enabled })
  const loadFirstSession = useCallback(async (agentId: string): Promise<AgentSessionListItem | null> => {
    const page = await dataApiService.get('/agent-sessions', {
      query: { agentId, limit: 1, sortBy: 'updatedAt' }
    })
    return page.items[0] ?? null
  }, [])
  const loadLatestSession = useCallback(async () => {
    const result = await dataApiService.get('/agent-sessions/latest')
    return result.session
  }, [])
  const loadSessionSeedCandidates = useCallback(async (agentId: string): Promise<AgentSessionListItem[]> => {
    const page = await dataApiService.get('/agent-sessions', {
      query: {
        agentId,
        limit: RESOURCE_SEED_PAGE_SIZE,
        sortBy: 'orderKey'
      }
    })
    return page.items
  }, [])

  return {
    stats: statsSource.stats,
    isStatsLoading: statsSource.isLoading,
    statsError: statsSource.error,
    refetchStats: statsSource.refetch,
    loadFirstSession,
    loadLatestSession,
    loadSessionSeedCandidates
  }
}

export type AssistantTopicsSource = ReturnType<typeof useAssistantTopicsSource>
export type AgentSessionsSource = ReturnType<typeof useAgentSessionsSource>
