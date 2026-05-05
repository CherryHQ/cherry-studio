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
/** Rough chars-per-token ratio. Good enough for budget estimation; we don't need
 *  per-tokenizer accuracy because the threshold has a 10% safety margin baked in. */
const CHARS_PER_TOKEN = 4

export interface ShouldDeferResult {
  /** Names of tools that should NOT appear in the inline ToolSet. */
  readonly deferredNames: ReadonlySet<string>
  /** Threshold derived from the model's context window. */
  readonly threshold: number
}

export function shouldDefer(entries: readonly ToolEntry[], contextWindow: number | undefined): ShouldDeferResult {
  const ctx = contextWindow && contextWindow > 0 ? contextWindow : FALLBACK_CONTEXT_WINDOW
  const threshold = Math.floor(ctx * (DEFER_THRESHOLD_PCT / 100))

  const alwaysDeferred = entries.filter((e) => e.defer === 'always')
  const autoCandidates = entries.filter((e) => e.defer === 'auto')

  const autoDeferred = estimateAutoTokens(autoCandidates) > threshold ? autoCandidates : []
  const deferredNames = new Set([...alwaysDeferred, ...autoDeferred].map((e) => e.name))

  return { deferredNames, threshold }
}

//TODO： token api
function estimateAutoTokens(entries: readonly ToolEntry[]): number {
  let chars = 0
  for (const entry of entries) {
    chars += entry.name.length
    // The LLM-visible cost is `tool.description` + `tool.inputSchema` (what
    // AI SDK serialises into the tools array). `entry.description` is only
    // shown by `tool_search`, never inline.
    const tool = entry.tool as { description?: string; inputSchema?: unknown }
    if (typeof tool.description === 'string') chars += tool.description.length
    if (tool.inputSchema) chars += JSON.stringify(tool.inputSchema).length
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
}
