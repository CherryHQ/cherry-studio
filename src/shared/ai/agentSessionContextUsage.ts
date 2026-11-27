import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

/** Product model association for a harness-owned context reading. */
export interface AgentSessionContextUsage {
  readonly modelId?: string
  readonly result: OperationResult<ThreadContextUsage>
}

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const
