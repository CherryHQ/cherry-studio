import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

/** Product model association for a harness-owned context reading. */
export interface AgentSessionContextUsage {
  readonly modelId?: string
  readonly result: OperationResult<ThreadContextUsage>
  /** Epoch ms when a confirmed reading with used tokens was measured (surfaced when retained). */
  readonly measuredAt?: number
  /** True when disconnect or a refresh failure kept the previous confirmed reading. */
  readonly stale?: boolean
}

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const
