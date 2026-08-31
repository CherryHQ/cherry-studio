import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import type { Topic as RendererTopic } from '@renderer/types/topic'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { createContext, use, useCallback } from 'react'

import { useSessions } from './agent/useSession'
import { mapApiTopicToRendererTopic, useTopics } from './useTopic'

/**
 * Window-level data sources shared by every kept-alive chat / agent route.
 *
 * The raw hooks are mounted once by ResourceViewSourceProvider. Route pages read
 * the provider's progressive cold-start data, then its last complete snapshot
 * during background refreshes. This keeps first-page content responsive without
 * letting multiple kept-alive tabs start competing load-all chains.
 */

/** Full agent-session page size — kept in one place so the rail and right panel never drift. */
const AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE = 200

export function useRawAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
  const listSource = useTopics({ loadAll: true, enabled })
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

  return { ...listSource, loadLatestTopic, reuseOrCreateTopic }
}

export function useRawAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  const listSource = useSessions(undefined, {
    loadAll: true,
    pageSize: AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE,
    enabled
  })
  const loadLatestSession = useCallback(async (agentId?: string | null) => {
    const result =
      agentId === undefined
        ? await dataApiService.get('/agent-sessions/latest')
        : await dataApiService.get('/agent-sessions/latest', { query: { agentId: agentId ?? 'unlinked' } })
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

  return { ...listSource, loadLatestSession, reuseOrCreateSession }
}

type RawAssistantTopicsSource = ReturnType<typeof useRawAssistantTopicsSource>
type RawAgentSessionsSource = ReturnType<typeof useRawAgentSessionsSource>

/**
 * A background refresh that failed while a committed snapshot is still on
 * screen. It is deliberately separate from `error`: the snapshot stays served
 * (blowing a good list away into an error panel is worse), but the failure must
 * not be silent — nothing retries on its own, so the list would otherwise stay
 * stale for the window's lifetime with no visible cause.
 */
type RefreshError = { refreshError: RawAssistantTopicsSource['error'] }

/**
 * View of the full topic list derived once per window (in
 * ResourceViewSourceProvider), so every kept-alive tab shares one mapped copy
 * instead of each remapping — and re-joining an order signature over — the
 * entire list.
 */
export type AssistantTopicsView = {
  /** `topics` mapped to the renderer {@link RendererTopic} shape. */
  rendererTopics: readonly RendererTopic[]
  /** Signature over order-relevant fields (id / assistantId / orderKey). */
  orderSignature: string
}

export function deriveAssistantTopicsView(topics: readonly ApiTopic[]): AssistantTopicsView {
  return {
    rendererTopics: topics.map(mapApiTopicToRendererTopic),
    orderSignature: topics.map((t) => `${t.id}:${t.assistantId ?? ''}:${t.orderKey ?? ''}`).join('|')
  }
}

export type AssistantTopicsSource = Pick<
  RawAssistantTopicsSource,
  | 'topics'
  | 'isLoadingAll'
  | 'isFullyLoaded'
  | 'isRefreshing'
  | 'error'
  | 'refetch'
  | 'loadLatestTopic'
  | 'reuseOrCreateTopic'
> &
  RefreshError &
  AssistantTopicsView

export type AgentSessionsSource = Pick<
  RawAgentSessionsSource,
  | 'sessions'
  | 'pinIdBySessionId'
  | 'hasMore'
  | 'error'
  | 'isLoading'
  | 'isLoadingMore'
  | 'isValidating'
  | 'reload'
  | 'deleteSession'
  | 'deleteSessions'
  | 'reorderSession'
  | 'togglePin'
  | 'isFullyLoaded'
  | 'isLoadingAll'
  | 'isPinsLoading'
  | 'loadLatestSession'
  | 'reuseOrCreateSession'
> &
  RefreshError

export const AssistantTopicsSourceContext = createContext<AssistantTopicsSource | null>(null)
export const AgentSessionsSourceContext = createContext<AgentSessionsSource | null>(null)

export function useAssistantTopicsSource(): AssistantTopicsSource {
  const source = use(AssistantTopicsSourceContext)
  if (!source) {
    throw new Error('useAssistantTopicsSource must be used within ResourceViewSourceProvider')
  }
  return source
}

export function useAgentSessionsSource(): AgentSessionsSource {
  const source = use(AgentSessionsSourceContext)
  if (!source) {
    throw new Error('useAgentSessionsSource must be used within ResourceViewSourceProvider')
  }
  return source
}
