/**
 * Single validation point for `Model.contextWindow` before it feeds any budget.
 *
 * `contextWindow` is `z.number().optional()` — custom / v1-imported / CherryAI
 * models really can arrive without it. Every budget in the context-build layer
 * multiplies it, so an absent value used to reach the arithmetic as `NaN`:
 * `Math.min(chars, NaN)` is `NaN`, the truncator's `text.length <= NaN` is
 * always false (so ordinary tool results got offloaded), and the durable /
 * in-loop `trigger` and `keepBudget` became `NaN` too — which disables the very
 * compaction that was supposed to protect the request.
 *
 * Returning `null` is the honest answer for "no window known": callers must
 * then skip window-derived budgets and fall back to the user's absolute
 * character settings, rather than computing a number that is silently wrong.
 */
export function resolveContextWindow(contextWindow: number | undefined): number | null {
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null
  }
  return contextWindow
}

/**
 * Smallest usable window across a multi-model send, or `null` when no model
 * declares one. Models without a window are skipped rather than poisoning the
 * minimum — a mixed send still budgets against the models that do declare one.
 */
export function resolveMinContextWindow(contextWindows: ReadonlyArray<number | undefined>): number | null {
  const known = contextWindows.map(resolveContextWindow).filter((w): w is number => w !== null)
  return known.length > 0 ? Math.min(...known) : null
}
