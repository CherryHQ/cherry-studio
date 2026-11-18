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
  modelId: string
  contextId: string
  headMessageId: string
  headUpdatedAt: string
  measuredAt: string
  usage: ThreadContextUsage
}

export function isAgentSessionContextUsageSnapshot(value: unknown): value is AgentSessionContextUsageSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    ['modelId', 'contextId', 'headMessageId', 'headUpdatedAt', 'measuredAt'].every(
      (key) => typeof record[key] === 'string' && record[key].length > 0
    ) &&
    !!record.usage &&
    typeof record.usage === 'object' &&
    !Array.isArray(record.usage)
  )
}
