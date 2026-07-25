import { createContext, use } from 'react'

import { useSessions } from './agent/useSession'
import { useTopics } from './useTopic'

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
  return useTopics({ loadAll: true, enabled })
}

export function useRawAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  return useSessions(undefined, { loadAll: true, pageSize: AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE, enabled })
}

type RawAssistantTopicsSource = ReturnType<typeof useRawAssistantTopicsSource>
type RawAgentSessionsSource = ReturnType<typeof useRawAgentSessionsSource>

export type AssistantTopicsSource = Pick<
  RawAssistantTopicsSource,
  'topics' | 'isLoadingAll' | 'isFullyLoaded' | 'isRefreshing' | 'error'
>

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
>

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
