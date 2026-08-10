import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'

const EMPTY_SESSION_ID = '__none__'

interface AgentSessionContextUsageState {
  usage: AgentSessionContextUsage | null
  percentage: number | null
  /** Denominator to render usage against — the model window when known. */
  maxTokens: number | null
}

/**
 * `usage.maxTokens` is the CLI's auto-compact window, not the model's context window: it tracks
 * whatever `autoCompactWindow` Cherry declared, so it shrinks by the output reservation. Prefer the
 * model's own `contextWindow` — the same denominator the chat composer uses — and fall back to the
 * SDK value only when the model declares no window.
 */
export function useAgentSessionContextUsage(
  sessionId: string | undefined,
  expectedModels?: readonly (string | null | undefined)[],
  contextWindow?: number
): AgentSessionContextUsageState {
  const cachedUsage = useSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  const sessionUsage = sessionId ? (cachedUsage ?? null) : null
  const effectiveUsage = isExpectedModelUsage(sessionUsage, expectedModels) ? sessionUsage : null
  const maxTokens = resolveMaxTokens(effectiveUsage, contextWindow)
  const rawPercentage =
    effectiveUsage && maxTokens ? (effectiveUsage.totalTokens / maxTokens) * 100 : effectiveUsage?.percentage
  const percentage = rawPercentage === undefined ? null : Math.round(Math.min(100, Math.max(0, rawPercentage)))

  return { usage: effectiveUsage, percentage, maxTokens }
}

function resolveMaxTokens(usage: AgentSessionContextUsage | null, contextWindow: number | undefined): number | null {
  if (!usage) return null
  if (typeof contextWindow === 'number' && contextWindow > 0) return contextWindow
  return usage.maxTokens > 0 ? usage.maxTokens : null
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
