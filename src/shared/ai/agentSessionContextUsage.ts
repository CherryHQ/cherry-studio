import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'

// The driver returns the SDK's context-usage payload verbatim (`query.getContextUsage()`), so alias
// the SDK type rather than hand-mirroring it — a shape change in the SDK surfaces at compile time
// instead of silently diverging the cached contract.
export type AgentSessionContextUsage = SDKControlGetContextUsageResponse

export const AgentSessionContextUsageSchema = z.custom<AgentSessionContextUsage>((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const usage = value as Partial<AgentSessionContextUsage>
  return (
    Array.isArray(usage.categories) &&
    typeof usage.totalTokens === 'number' &&
    typeof usage.maxTokens === 'number' &&
    typeof usage.percentage === 'number' &&
    typeof usage.model === 'string'
  )
})

export const AgentSessionContextUsageSnapshotSchema = z.strictObject({
  usage: AgentSessionContextUsageSchema,
  capturedAt: z.iso.datetime()
})

export type AgentSessionContextUsageSnapshot = z.infer<typeof AgentSessionContextUsageSnapshotSchema>
export type AgentSessionContextUsageSource = 'live' | 'snapshot' | 'none'

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const
