import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_API_RETRY_CACHE_KEY, type AgentSessionApiRetryState } from '@shared/ai/agentSessionApiRetry'

const EMPTY_SESSION_ID = '__none__'
const IDLE_API_RETRY_STATE: AgentSessionApiRetryState = { status: 'idle' }

/**
 * Read-only observer of the Main-owned api-retry state. Uses `useSharedCacheValue` (not the writable
 * `useSharedCache`) so a mount before Main publishes never materializes the schema default and clobbers
 * a live `retrying` value, and never pins the key against the owner's deletion — matching the sibling
 * compaction / context-usage / slash-command hooks.
 */
export function useAgentSessionApiRetry(sessionId: string | undefined): AgentSessionApiRetryState {
  const state = useSharedCacheValue(AGENT_SESSION_API_RETRY_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  if (!sessionId) return IDLE_API_RETRY_STATE
  return state ?? IDLE_API_RETRY_STATE
}
