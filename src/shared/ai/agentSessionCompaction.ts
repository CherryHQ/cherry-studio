export type AgentSessionCompactionTrigger = 'manual' | 'auto'

export interface AgentSessionCompactionAnchorData {
  trigger: AgentSessionCompactionTrigger
  completedAt: string
  preTokens?: number
  postTokens?: number
  durationMs?: number
}

export type AgentSessionCompactionState =
  | {
      status: 'idle'
      lastCompletedAt?: string
      lastError?: string
      preTokens?: number
      postTokens?: number
      durationMs?: number
    }
  | {
      status: 'compacting'
      startedAt: string
      trigger?: AgentSessionCompactionTrigger
    }

export const AGENT_SESSION_COMPACTION_CACHE_KEY = (sessionId: string) =>
  `agent.session.compaction.${sessionId}` as const
