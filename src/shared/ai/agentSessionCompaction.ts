export type AgentSessionCompactionTrigger = 'manual' | 'auto'

export interface AgentSessionCompactionAnchorData {
  trigger: AgentSessionCompactionTrigger
  completedAt: string
  preTokens?: number
  postTokens?: number
  durationMs?: number
}

// The cache state is read only for `status` (the composer's "compacting" indicator). Completed-run
// metrics reach the UI via the `data-compaction-anchor` message chunk (see MessagePartsRenderer), and
// compaction failures surface through the turn error — so no outcome fields live here. Keeping the
// union to `idle | compacting` removes the illegal combinations the old flat `idle` branch allowed.
export type AgentSessionCompactionState =
  | { status: 'idle' }
  | {
      status: 'compacting'
      startedAt: string
      trigger?: AgentSessionCompactionTrigger
    }

export const AGENT_SESSION_COMPACTION_CACHE_KEY = (sessionId: string) =>
  `agent.session.compaction.${sessionId}` as const
