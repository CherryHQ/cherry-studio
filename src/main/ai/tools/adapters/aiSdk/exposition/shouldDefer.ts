/**
 * Decide which tools to defer behind `tool_search`. See
 * `docs/references/ai/tool-registry.md` for the design (threshold,
 * gates, defer policies).
 */

import type { ToolEntry } from '../types'

const DEFER_THRESHOLD_PCT = 10
const FALLBACK_CONTEXT_WINDOW = 32_000
const CHARS_PER_TOKEN = 4

/** Static cost of `tool_search` + `tool_inspect` + `tool_invoke` + DEFERRED_TOOLS header. */
const META_TOOLS_OVERHEAD_TOKENS = 500

/** Below this the meta-tools round-trip costs more than inlining. */
const MIN_AUTO_DEFER_COUNT = 5

export interface ShouldDeferResult {
  readonly deferredNames: ReadonlySet<string>
  readonly threshold: number
}

export function shouldDefer(entries: readonly ToolEntry[], contextWindow: number | undefined): ShouldDeferResult {
  const ctx = contextWindow && contextWindow > 0 ? contextWindow : FALLBACK_CONTEXT_WINDOW
  const threshold = Math.floor(ctx * (DEFER_THRESHOLD_PCT / 100))

  const alwaysDeferred = entries.filter((e) => e.defer === 'always')
  const autoCandidates = entries.filter((e) => e.defer === 'auto')

  const autoCost = estimateAutoTokens(autoCandidates)
  const autoOverflowsThreshold = autoCost > threshold
  const autoPoolBigEnough = autoCandidates.length >= MIN_AUTO_DEFER_COUNT
  const autoSavingsBeatOverhead = autoCost > META_TOOLS_OVERHEAD_TOKENS
  const autoDeferred = autoOverflowsThreshold && autoPoolBigEnough && autoSavingsBeatOverhead ? autoCandidates : []

  const deferredNames = new Set([...alwaysDeferred, ...autoDeferred].map((e) => e.name))

  return { deferredNames, threshold }
}

// TODO: replace the chars/4 heuristic with a real tokenizer token-count API
function estimateAutoTokens(entries: readonly ToolEntry[]): number {
  let chars = 0
  for (const entry of entries) {
    chars += entry.name.length
    // LLM-visible cost is `tool.description` + `tool.inputSchema`; `entry.description`
    // is only shown by `tool_search`.
    //
    // The char count is a deliberately coarse, pre-normalization proxy: `inputSchema` may be
    // Zod, a `jsonSchema` wrapper, or raw JSONSchema, so its stringified length differs from the
    // canonical JSONSchema the model actually sees (cf. `asSchema(...).jsonSchema` in toolSearch).
    // We skip that async normalization on purpose — this is only a defer/inline gate, not a budget.
    const tool = entry.tool as { description?: string; inputSchema?: unknown }
    if (typeof tool.description === 'string') chars += tool.description.length
    if (tool.inputSchema) chars += JSON.stringify(tool.inputSchema).length
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
}
