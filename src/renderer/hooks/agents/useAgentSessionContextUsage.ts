import { useSharedCache } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'

const EMPTY_SESSION_ID = '__none__'

interface AgentSessionContextUsageState {
  usage: AgentSessionContextUsage | null
  percentage: number | null
}

export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  expectedModels?: readonly (string | null | undefined)[]
): AgentSessionContextUsageState {
  const [cachedUsage] = useSharedCache(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  const sessionUsage = sessionId ? (cachedUsage ?? null) : null
  const effectiveUsage = isExpectedModelUsage(sessionUsage, expectedModels) ? sessionUsage : null
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
