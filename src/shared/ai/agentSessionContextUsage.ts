import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

/** Product model association for a harness-owned context reading. */
export interface AgentSessionContextUsage {
  readonly modelId?: string
  readonly snapshot?: { readonly measuredAt: string; readonly restored: true }
  readonly result: OperationResult<ThreadContextUsage>
}

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const

export interface AgentSessionContextUsageSnapshot {
  version: 1
  modelId: string
  agentUpdatedAt: string
  contextId: string
  backendId: string
  nativeThreadId: string
  headMessageId: string
  headUpdatedAt: string
  measuredAt: string
  usage: ThreadContextUsage
}
