import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_TASK_EVENTS_CACHE_KEY,
  type AgentSessionTaskEvents
} from '@shared/ai/agentSessionBackgroundTasks'

const EMPTY_SESSION_ID = '__none__'
const NO_EVENTS: AgentSessionTaskEvents = {}

/**
 * Latest task lifecycle edge for the current CLI process, keyed by task id. In-turn events also
 * reach the transcript as hidden message parts; this cache supplies the live per-task state after
 * the spawning turn closes and is reset at every connection boundary.
 *
 * Main owns this key, so this window must only ever read it.
 */
export function useAgentSessionTaskEvents(sessionId: string | undefined): AgentSessionTaskEvents {
  const cached = useSharedCacheValue(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))

  if (!sessionId) return NO_EVENTS
  return cached ?? NO_EVENTS
}
