import { useSharedCache } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_COMPACTION_CACHE_KEY, type AgentSessionCompactionState } from '@shared/ai/agentSessionCompaction'

const EMPTY_SESSION_ID = '__none__'
const IDLE_COMPACTION_STATE: AgentSessionCompactionState = { status: 'idle' }

export function useAgentSessionCompaction(sessionId: string | undefined): AgentSessionCompactionState {
  const [state] = useSharedCache(AGENT_SESSION_COMPACTION_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  if (!sessionId) return IDLE_COMPACTION_STATE
  return state ?? IDLE_COMPACTION_STATE
}
