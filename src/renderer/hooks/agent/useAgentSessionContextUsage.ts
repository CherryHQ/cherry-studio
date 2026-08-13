import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { useMemo } from 'react'

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
  model?: Model
): AgentSessionContextUsageState {
  const cachedUsage = useSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(sessionId ?? EMPTY_SESSION_ID))
  const expectedModels = useMemo(() => getContextUsageModelCandidates(model), [model])
  const sessionUsage = sessionId ? (cachedUsage ?? null) : null
  const effectiveUsage = isExpectedModelUsage(sessionUsage, expectedModels) ? sessionUsage : null
  const maxTokens = resolveMaxTokens(effectiveUsage, model?.contextWindow)
  const rawPercentage =
    effectiveUsage && maxTokens ? (effectiveUsage.totalTokens / maxTokens) * 100 : effectiveUsage?.percentage
  const percentage = rawPercentage === undefined ? null : Math.round(Math.min(100, Math.max(0, rawPercentage)))

  return { usage: effectiveUsage, percentage, maxTokens }
}

// Claude Code ignores the window Cherry declares for its own models and applies its per-plan one, so
// there `usage.maxTokens` is the effective window — the catalog cannot tell a 200K session from its
// `[1m]` twin, since both rows resolve to the same entry. Elsewhere it is only our compaction budget.
function resolveMaxTokens(usage: AgentSessionContextUsage | null, contextWindow: number | undefined): number | null {
  if (!usage) return null
  const reported = usage.maxTokens > 0 ? usage.maxTokens : null
  if (typeof contextWindow !== 'number' || contextWindow <= 0) return reported
  if (reported && usage.model.trim().toLowerCase().startsWith('claude-')) return Math.min(contextWindow, reported)
  return contextWindow
}

// The usage cache deliberately survives reconnects, so a stale entry from the previous model must
// not be divided by the new model's window.
function getContextUsageModelCandidates(model: Model | undefined): string[] | undefined {
  if (!model) return undefined
  let parsed: ReturnType<typeof parseUniqueModelId>
  try {
    parsed = parseUniqueModelId(model.id)
  } catch {
    // `ModelSchema` rejects these, so this is unreachable by design — but a throw here unmounts the
    // pane, and returning nothing would disable filtering entirely. Match on the id itself instead.
    return [model.apiModelId ?? model.id]
  }

  const apiModelId = model.apiModelId ?? parsed.modelId
  const candidates = [apiModelId, parsed.modelId]
  try {
    candidates.push(formatGatewayModelId(parsed.providerId, apiModelId))
  } catch {
    // Some models are intentionally not gateway-addressable; their direct ids remain valid candidates.
  }

  return candidates
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
