import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'

export type AgentSessionContextUsage = SDKControlGetContextUsageResponse
export type AgentSessionContextUsageBySession = Record<string, AgentSessionContextUsage>

export const AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY = 'agent.session.context_usage.by_session' as const
