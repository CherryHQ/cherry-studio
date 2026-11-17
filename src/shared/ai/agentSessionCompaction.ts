import type { CompactionAnchorData, CompactionTrigger } from './compaction'

export type AgentSessionCompactionTrigger = CompactionTrigger

/**
 * Agent-session view of the shared anchor payload — same part, `phase:
 * 'agent-session'`. Kept as a named alias so the session code reads in its own
 * vocabulary while the UI has exactly one anchor shape to render.
 */
export type AgentSessionCompactionAnchorData = CompactionAnchorData

// Completed-run metrics use data-compaction-anchor; non-terminal failures stay visible in the cache.
export type AgentSessionCompactionState =
  | { status: 'idle' }
  | { status: 'failed'; error: string }
  | {
      status: 'compacting'
      startedAt: string
      trigger?: AgentSessionCompactionTrigger
    }

export const AGENT_SESSION_COMPACTION_CACHE_KEY = (sessionId: string) =>
  `agent.session.compaction.${sessionId}` as const
