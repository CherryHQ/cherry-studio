import { useSessions } from './agent/useSession'
import { useTopics } from './useTopic'

/**
 * Shared page-level data sources for the classic-layout layout.
 *
 * In classic layout the entity rail and the right-panel resource list are two separate components that
 * both need the full topic/session list (the rail to decide which entities own resources, the panel
 * to render the current entity's resources). The page owns these source objects and threads them into
 * child views so there is one load policy and no chance of the call sites drifting on options
 * (e.g. page size).
 */

/** Full agent-session page size — kept in one place so the rail and right panel never drift. */
const AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE = 200

/**
 * The shared full-topics source for the assistant classic-layout rail + right-panel topic list.
 *
 * `enabled` lets the owning page gate the fetch when the route does not need the full topic list.
 */
export function useAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
  return useTopics({ loadAll: true, enabled })
}

/** The shared full-sessions source for the agent classic-layout rail + right-panel session list. */
export function useAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  return useSessions(undefined, { loadAll: true, pageSize: AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE, enabled })
}

export type AssistantTopicsSource = ReturnType<typeof useAssistantTopicsSource>
export type AgentSessionsSource = ReturnType<typeof useAgentSessionsSource>
