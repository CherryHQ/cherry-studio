import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_TASK_EVENTS_CACHE_KEY,
  type AgentSessionTaskEvents
} from '@shared/ai/agentSessionBackgroundTasks'

const EMPTY_SESSION_ID = '__none__'
const NO_EVENTS: AgentSessionTaskEvents = {}

/**
 * Current CLI process's latest task lifecycle keyed by task id. In-turn events also reach the
 * transcript as message parts; this session-scoped edge map provides per-task liveness and stop IDs
 * without correlating the SDK's separate aggregate background-task level.
 *
 * Main owns this key, so this window must only ever read it.
 */
export function useAgentSessionTaskEvents(sessionId: string | undefined): AgentSessionTaskEvents {
  const cached = useSharedCacheValue(AGENT_SESSION_TASK_EVENTS_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))

  if (!sessionId) return NO_EVENTS
  return cached ?? NO_EVENTS
}
