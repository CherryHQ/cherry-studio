/**
 * Reasoning-budget computation shared between main and renderer.
 *
 * Runtime callers pass descriptor-declared token limits. A caller whose wire
 * requires a budget even without declared limits can opt into the conservative
 * `FALLBACK_TOKEN_LIMIT`; otherwise missing limits remain visible as
 * `undefined`.
 */

import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { EFFORT_RATIO } from '@shared/utils/reasoning'

/** Used when a descriptor has no token limits and the caller still needs a
 *  non-undefined budget for its wire envelope.
 *  `Math.max(1024, …)` in `computeBudgetTokens` enforces the floor. */
export const FALLBACK_TOKEN_LIMIT = { min: 1024, max: 16384 }

const BUDGET_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export function computeBudgetTokens(
  tokenLimit: { min: number; max: number },
  effortRatio: number,
  maxTokens?: number
): number {
  const budget = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
  const capped = maxTokens !== undefined ? Math.min(budget, maxTokens) : budget
  return Math.max(1024, capped)
}

/**
 * Reverse a fixed thinking budget to the closest shared effort tier.
 * Semantic sentinels (`none`, `auto`) are intentionally excluded; `minimal`
 * shares `low`'s ratio, so the more widely supported `low` is canonical.
 * Ties resolve upward, matching the effort-vocabulary reconciliation policy.
 */
export function nearestEffortForBudget(
  budget: number,
  tokenLimit: { min?: number; max?: number } | undefined
): ReasoningEffortOption | undefined {
  if (!Number.isFinite(budget) || tokenLimit?.min == null || tokenLimit.max == null) return undefined

  const limits = { min: tokenLimit.min, max: tokenLimit.max }
  let nearest: (typeof BUDGET_EFFORTS)[number] = BUDGET_EFFORTS[0]
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const effort of BUDGET_EFFORTS) {
    const distance = Math.abs(budget - computeBudgetTokens(limits, EFFORT_RATIO[effort]))
    if (distance <= nearestDistance) {
      nearest = effort
      nearestDistance = distance
    }
  }

  return nearest
}

export interface ThinkingBudgetOptions {
  /**
   * When true and `tokenLimit` is absent, derive a budget from
   * `FALLBACK_TOKEN_LIMIT` instead of returning `undefined`.
   */
  fallbackOnUnknown?: boolean
}

/**
 * Resolve the `thinking_budget` / `budgetTokens` value to send to a
 * reasoning model, given the user's effort setting.
 *
 * @param effortRatioMap - The runtime `EFFORT_RATIO` lookup. Pass it in
 *   rather than importing from a renderer-only path so this module stays
 *   in `packages/shared` without dragging the table along.
 */
export function getThinkingBudget(
  maxTokens: number | undefined,
  reasoningEffort: string | undefined,
  tokenLimit: { min?: number; max?: number } | undefined,
  effortRatioMap: Record<string, number>,
  opts: ThinkingBudgetOptions = {}
): number | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'none') {
    return undefined
  }

  if (tokenLimit?.min == null || tokenLimit.max == null) {
    if (!opts.fallbackOnUnknown) return undefined
    const ratio = effortRatioMap[reasoningEffort] ?? effortRatioMap.high
    return computeBudgetTokens(FALLBACK_TOKEN_LIMIT, ratio, maxTokens)
  }

  // Guard the same way as the fallback path: an unknown effort key would otherwise
  // yield a NaN budget that the Anthropic/Claude SDK rejects.
  return computeBudgetTokens(
    { min: tokenLimit.min, max: tokenLimit.max },
    effortRatioMap[reasoningEffort] ?? effortRatioMap.high,
    maxTokens
  )
}
