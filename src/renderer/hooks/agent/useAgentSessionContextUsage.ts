import type { ThreadContextUsage } from '@cherrystudio/agent-runtime'
import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import type { Model } from '@shared/data/types/model'

interface AgentSessionContextUsageState {
  usage: ThreadContextUsage | null
  percentage: number | null
  maxTokens: number | null
}

export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  model?: Model
): AgentSessionContextUsageState {
  const cached = useSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? '__none__'))
  const result = sessionId && (!model || !cached?.modelId || cached.modelId === model.id) ? cached?.result : undefined
  const usage = result?.status === 'confirmed' ? result.value : null
  const maxTokens = usage?.contextWindow ?? null
  const percentage =
    usage?.used && maxTokens ? Math.round(Math.min(100, Math.max(0, (usage.used.tokens / maxTokens) * 100))) : null
  return { usage, percentage, maxTokens }
}
