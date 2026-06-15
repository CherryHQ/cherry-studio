import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'

export type AgentSessionContextUsage = SDKControlGetContextUsageResponse

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = (sessionId: string) =>
  `agent.session.context_usage.${sessionId}` as const
