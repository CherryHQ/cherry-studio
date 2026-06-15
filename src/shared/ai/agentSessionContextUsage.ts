import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'

// The driver returns the SDK's context-usage payload verbatim (`query.getContextUsage()`), so alias
// the SDK type rather than hand-mirroring it — a shape change in the SDK surfaces at compile time
// instead of silently diverging the cached contract.
export type AgentSessionContextUsage = SDKControlGetContextUsageResponse

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const
