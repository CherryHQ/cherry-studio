import { dataApiService } from '@renderer/data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { useCallback } from 'react'

import { useAgentSessionStats } from './agent/useSession'
import { useTopicStats } from './useTopic'

/**
 * Page-level resource facts and exact derived lookups shared by classic rails,
 * conversation pages, and their right-panel lists.
 */

/**
 * Factual counts support badges and synthetic record-group visibility. Imperative lookups
 * use scoped latest for owner navigation and domain reads for placeholder reuse.
 */
export function useAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useTopicStats({ enabled })
  const loadLatestTopic = useCallback(async (assistantId?: string, excludeTopicId?: string) => {
    const query = { ...(assistantId ? { assistantId } : {}), ...(excludeTopicId ? { excludeTopicId } : {}) }
    const result =
      Object.keys(query).length === 0
        ? await dataApiService.get('/topics/latest')
        : await dataApiService.get('/topics/latest', { query })
    return result.topic
  }, [])
  const reuseOrCreateTopic = useCallback(async (assistantId: string) => {
    return dataApiService.post('/topics/reusable-placeholder', {
      body: { assistantId }
    })
  }, [])

  return {
    stats: statsSource.stats,
    loadLatestTopic,
    reuseOrCreateTopic
  }
}

/** Session counterpart to {@link useAssistantTopicsSource}. */
export function useAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  const statsSource = useAgentSessionStats({ enabled })
  const loadLatestSession = useCallback(async (agentId?: string, excludeSessionId?: string) => {
    const query = { ...(agentId ? { agentId } : {}), ...(excludeSessionId ? { excludeSessionId } : {}) }
    const result =
      Object.keys(query).length === 0
        ? await dataApiService.get('/agent-sessions/latest')
        : await dataApiService.get('/agent-sessions/latest', { query })
    return result.session
  }, [])
  const reuseOrCreateSession = useCallback(
    async (agentId: string, workspace: AgentSessionWorkspaceSource, excludeSessionId?: string) => {
      return ipcApi.request('ai.agent.session.reuse_or_create', {
        agentId,
        workspace,
        ...(excludeSessionId ? { excludeSessionId } : {})
      })
    },
    []
  )
  return {
    stats: statsSource.stats,
    loadLatestSession,
    reuseOrCreateSession
  }
}

export type AssistantTopicsSource = ReturnType<typeof useAssistantTopicsSource>
export type AgentSessionsSource = ReturnType<typeof useAgentSessionsSource>
