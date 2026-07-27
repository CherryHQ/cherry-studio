import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_TASK_EVENTS_CACHE_KEY,
  type AgentSessionTaskEvents
} from '@shared/ai/agentSessionBackgroundTasks'

const EMPTY_SESSION_ID = '__none__'
const NO_EVENTS: AgentSessionTaskEvents = {}

/**
 * Task lifecycle that arrived after the spawning turn's message stream closed, keyed by task id.
 * In-turn events are message parts and already reach the projection; these are the tail a
 * background task emits once there is no message left to carry it — without them a detached task's
 * row would stay running for the rest of the session.
 *
 * Main owns this key, so this window must only ever read it.
 */
export function useAgentSessionTaskEvents(sessionId: string | undefined): AgentSessionTaskEvents {
  const cached = useSharedCacheValue(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))

  if (!sessionId) return NO_EVENTS
  return cached ?? NO_EVENTS
}
