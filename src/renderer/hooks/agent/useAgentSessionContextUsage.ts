import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionContextUsageSummary } from '@shared/data/cache/cacheValueTypes'

const EMPTY_SESSION_ID = '__none__'

interface AgentSessionContextUsageState {
  usage: AgentSessionContextUsageSummary | null
  percentage: number | null
}

export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  expectedModels?: readonly (string | null | undefined)[]
): AgentSessionContextUsageState {
  const cachedUsage = useSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  const effectiveUsage =
    sessionId && isExpectedModelUsage(cachedUsage ?? null, expectedModels) ? (cachedUsage ?? null) : null
  const percentage =
    effectiveUsage?.percentage === undefined ? null : Math.round(Math.min(100, Math.max(0, effectiveUsage.percentage)))

  return { usage: effectiveUsage, percentage }
}

function isExpectedModelUsage(
  usage: AgentSessionContextUsageSummary | null,
  expectedModels: readonly (string | null | undefined)[] | undefined
): boolean {
  if (!usage) return true
  const expected = expectedModels?.map(normalizeModelId).filter((model): model is string => Boolean(model))
  if (!expected?.length) return true

  const actual = normalizeModelId(usage.model)
  return Boolean(actual && expected.includes(actual))
}

function normalizeModelId(model: string | null | undefined): string | undefined {
  const normalized = model
    ?.trim()
    .replace(/\[1m\]$/i, '')
    .toLowerCase()
  return normalized || undefined
}
