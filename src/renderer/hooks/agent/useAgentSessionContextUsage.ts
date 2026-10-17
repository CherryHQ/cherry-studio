import { useMemo } from 'react'

import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage,
  getContextUsageModelCandidates,
  isExpectedModelUsage,
  resolveMaxTokens
} from '@shared/ai/agentSessionContextUsage'
import type { Model } from '@shared/data/types/model'

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
