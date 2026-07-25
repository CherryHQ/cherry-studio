import { createContext, use } from 'react'

import { useSessions } from './agent/useSession'
import { useTopics } from './useTopic'

/**
 * Window-level data sources shared by every kept-alive chat / agent route.
 *
 * The raw hooks are mounted once by ResourceViewSourceProvider. Route pages read
 * the provider's last complete snapshot so intermediate cursor pages never leak
 * into grouping / sorting and multiple kept-alive tabs do not start competing
 * load-all chains.
 */

/** Full agent-session page size — kept in one place so the rail and right panel never drift. */
const AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE = 200

export function useRawAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
  return useTopics({ loadAll: true, enabled })
}

export function useRawAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  return useSessions(undefined, { loadAll: true, pageSize: AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE, enabled })
}

export type AssistantTopicsSource = ReturnType<typeof useRawAssistantTopicsSource>
export type AgentSessionsSource = ReturnType<typeof useRawAgentSessionsSource>

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
