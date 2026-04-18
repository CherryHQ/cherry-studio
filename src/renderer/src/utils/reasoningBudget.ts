import { findTokenLimit } from '@renderer/config/models'
import { EFFORT_RATIO } from '@renderer/types'

/** TODO(renderer/aiCore-cleanup): only `getThinkingBudget` is extracted here. Migrate or delete the remaining reasoning helpers from the old renderer aiCore module after code/CLI flows are fully decoupled. */
const FALLBACK_TOKEN_LIMIT = { min: 1024, max: 16384 }

function computeBudgetTokens(
  tokenLimit: { min: number; max: number },
  effortRatio: number,
  maxTokens?: number
): number {
  const budget = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
  const capped = maxTokens !== undefined ? Math.min(budget, maxTokens) : budget
  return Math.max(1024, capped)
}

export function getThinkingBudget(
  maxTokens: number | undefined,
  reasoningEffort: string | undefined,
  modelId: string
): number | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'none') {
    return undefined
  }

  const tokenLimit = findTokenLimit(modelId)
  if (!tokenLimit) {
    const effortRatio = EFFORT_RATIO[reasoningEffort ?? 'high'] ?? EFFORT_RATIO.high
    return computeBudgetTokens(FALLBACK_TOKEN_LIMIT, effortRatio, maxTokens)
  }

  return computeBudgetTokens(tokenLimit, EFFORT_RATIO[reasoningEffort], maxTokens)
}
