import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

/** Product model association for a harness-owned context reading. */
export interface AgentSessionContextUsage {
  readonly modelId?: string
  readonly result: OperationResult<ThreadContextUsage>
  /** Epoch ms when a retained confirmed reading was measured after a refresh failure. */
  readonly measuredAt?: number
  /** True when a refresh failed and the previous confirmed reading was kept. */
  readonly stale?: boolean
}

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const
