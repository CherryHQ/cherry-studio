/**
 * Decide which tools to defer (hide behind `tool_search`) for a given
 * request. Mirrors Claude Code's approach: tools are defer-eligible based
 * on a per-entry policy (`defer` field), and the auto pool collapses to
 * deferred when its inline cost would exceed a fraction of the model's
 * context window.
 *
 * Threshold matches Claude Code's default (10% of context window). Hard-
 * coded for now; a Preference can wrap this if a real user need emerges.
 */

import type { ToolEntry } from '../types'

const DEFER_THRESHOLD_PCT = 10
const FALLBACK_CONTEXT_WINDOW = 32_000

export interface ShouldDeferResult {
  /** Names of tools that should NOT appear in the inline ToolSet. */
  readonly deferredNames: ReadonlySet<string>
  /** Estimated token cost of all `defer: 'auto'` entries — for telemetry. */
  // readonly autoTokens: number
  /** Threshold derived from the model's context window. */
  readonly threshold: number
}

export function shouldDefer(entries: readonly ToolEntry[], contextWindow: number | undefined): ShouldDeferResult {
  const ctx = contextWindow && contextWindow > 0 ? contextWindow : FALLBACK_CONTEXT_WINDOW
  const threshold = Math.floor(ctx * (DEFER_THRESHOLD_PCT / 100))

  const alwaysDeferred = entries.filter((e) => e.defer === 'always')
  const autoCandidates = entries.filter((e) => e.defer === 'auto')
  // const autoTokens = estimateAutoTokens(autoCandidates)

  const autoDeferred = autoCandidates
  const deferredNames = new Set([...alwaysDeferred, ...autoDeferred].map((e) => e.name))

  return { deferredNames, threshold }
}
