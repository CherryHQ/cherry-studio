import { usePersistCache } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'

interface AgentSessionContextUsageState {
  usage: AgentSessionContextUsage | null
  percentage: number | null
}

export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  expectedModels?: readonly (string | null | undefined)[]
): AgentSessionContextUsageState {
  const [usageBySession] = usePersistCache(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY)
  const cachedUsage = sessionId ? (usageBySession?.[sessionId] ?? null) : null
  const effectiveUsage = isExpectedModelUsage(cachedUsage, expectedModels) ? cachedUsage : null
  const percentage =
    effectiveUsage?.percentage === undefined ? null : Math.round(Math.min(100, Math.max(0, effectiveUsage.percentage)))

  return { usage: effectiveUsage, percentage }
}

function isExpectedModelUsage(
  usage: AgentSessionContextUsage | null,
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
