import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY,
  type AgentSessionBackgroundTasks
} from '@shared/ai/agentSessionBackgroundTasks'

const EMPTY_SESSION_ID = '__none__'
const NO_TASKS: AgentSessionBackgroundTasks = []

/**
 * Background work still running in an agent session — shells, subagents and workflows that outlive
 * the turn that spawned them. Main republishes the SDK's full membership snapshot on every change,
 * so this is a level, not an edge stream: the list is always the current truth and needs no
 * pairing of start/finish events.
 *
 * Main owns this key, so this window must only ever read it — `useSharedCacheValue` never seeds the
 * schema default back, which would clobber Main's published set during the mount race.
 */
export function useAgentSessionBackgroundTasks(sessionId: string | undefined): AgentSessionBackgroundTasks {
  const cached = useSharedCacheValue(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))

  if (!sessionId) return NO_TASKS
  return cached ?? NO_TASKS
}
