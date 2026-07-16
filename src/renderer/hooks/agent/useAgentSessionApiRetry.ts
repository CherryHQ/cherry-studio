import { useSharedCache } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_API_RETRY_CACHE_KEY, type AgentSessionApiRetryState } from '@shared/ai/agentSessionApiRetry'

const EMPTY_SESSION_ID = '__none__'
const IDLE_API_RETRY_STATE: AgentSessionApiRetryState = { status: 'idle' }

export function useAgentSessionApiRetry(sessionId: string | undefined): AgentSessionApiRetryState {
  const [state] = useSharedCache(AGENT_SESSION_API_RETRY_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  if (!sessionId) return IDLE_API_RETRY_STATE
  return state ?? IDLE_API_RETRY_STATE
}
