/**
 * Reasoning-budget computation shared between main and renderer.
 *
 * Both sides used to carry their own copy of `getThinkingBudget` — the main
 * version returned `undefined` when `findTokenLimit` had no entry for the
 * model; the renderer Code page falls back to a conservative
 * `FALLBACK_TOKEN_LIMIT` to keep producing a budget for unknown models.
 * The single source of truth here exposes that divergence as
 * `opts.fallbackOnUnknown`.
 */

import { findTokenLimit } from '../utils/model'

/** Used when the registry has no token-limit entry for a model and the
 *  caller still wants a non-undefined budget (renderer Code page).
 *  `Math.max(1024, …)` in `computeBudgetTokens` enforces the floor. */
export const FALLBACK_TOKEN_LIMIT = { min: 1024, max: 16384 }

export function computeBudgetTokens(
  tokenLimit: { min: number; max: number },
  effortRatio: number,
  maxTokens?: number
): number {
  const budget = Math.floor((tokenLimit.max - tokenLimit.min) * effortRatio + tokenLimit.min)
  const capped = maxTokens !== undefined ? Math.min(budget, maxTokens) : budget
  return Math.max(1024, capped)
}

export interface ThinkingBudgetOptions {
  /**
   * When true and the model isn't in `findTokenLimit`'s registry, derive
   * a budget from `FALLBACK_TOKEN_LIMIT` instead of returning `undefined`.
   * Renderer Code page sets this; main path leaves it false so the missing
   * entry surfaces as "no budget" upstream.
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
  modelId: string,
  effortRatioMap: Record<string, number>,
  opts: ThinkingBudgetOptions = {}
): number | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'none') {
    return undefined
  }

  const tokenLimit = findTokenLimit(modelId)
  if (!tokenLimit) {
    if (!opts.fallbackOnUnknown) return undefined
    const ratio = effortRatioMap[reasoningEffort] ?? effortRatioMap.high
    return computeBudgetTokens(FALLBACK_TOKEN_LIMIT, ratio, maxTokens)
  }

  return computeBudgetTokens(tokenLimit, effortRatioMap[reasoningEffort], maxTokens)
}
