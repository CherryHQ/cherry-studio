import { useSessions } from './agent/useSession'
import { useTopics } from './useTopic'

/**
 * Shared page-level data sources for the classic-layout layout.
 *
 * In classic layout the entity rail and the right-panel resource list are two separate components that
 * both need the full topic/session list (the rail to decide which entities own resources, the panel
 * to render the current entity's resources). They MUST read through one definition so they resolve
 * to a single SWR key — one fetch, and no chance of the two call sites drifting on load options
 * (e.g. page size). These thin hooks are that single definition; consume them from both sides
 * instead of calling `useTopics`/`useSessions` ad hoc.
 */

/** Full agent-session page size — kept in one place so the rail and right panel never drift. */
const AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE = 200

/**
 * The shared full-topics source for the assistant classic-layout rail + right-panel topic list.
 *
 * `enabled` lets always-mounted consumers (e.g. HomePage) gate the fetch to classic layout so modern layout
 * pays nothing; classic-layout consumers share the same SWR key, so there is still a single fetch.
 */
export function useAssistantTopicsSource({ enabled }: { enabled?: boolean } = {}) {
  return useTopics({ loadAll: true, enabled })
}

/** The shared full-sessions source for the agent classic-layout rail + right-panel session list. */
export function useAgentSessionsSource({ enabled }: { enabled?: boolean } = {}) {
  return useSessions(undefined, { loadAll: true, pageSize: AGENT_SESSIONS_LOAD_ALL_PAGE_SIZE, enabled })
}
