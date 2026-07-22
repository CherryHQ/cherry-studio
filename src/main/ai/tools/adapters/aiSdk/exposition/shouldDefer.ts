/**
 * Decide which tools to defer behind `tool_search`. See
 * `docs/references/ai/tool-registry.md` for the design (threshold,
 * gates, defer policies).
 */

import { countToolTokens } from '@main/ai/tokens/footprint'
import { tokenxTokenizer } from '@main/ai/tokens/textTokenizer'

import { serializeToolSchema } from '../meta/schemaStub'
import type { ToolEntry } from '../types'

const DEFER_THRESHOLD_PCT = 10
const FALLBACK_CONTEXT_WINDOW = 32_000

/** Static cost of `tool_search` + `tool_inspect` + `tool_invoke` + DEFERRED_TOOLS header. */
const META_TOOLS_OVERHEAD_TOKENS = 500

/** Below this the meta-tools round-trip costs more than inlining. */
const MIN_AUTO_DEFER_COUNT = 5

export interface ShouldDeferResult {
  readonly deferredNames: ReadonlySet<string>
  readonly threshold: number
}

export async function shouldDefer(
  entries: readonly ToolEntry[],
  contextWindow: number | undefined
): Promise<ShouldDeferResult> {
  const ctx = contextWindow && contextWindow > 0 ? contextWindow : FALLBACK_CONTEXT_WINDOW
  const threshold = Math.floor(ctx * (DEFER_THRESHOLD_PCT / 100))

  const alwaysDeferred = entries.filter((e) => e.defer === 'always')
  const autoCandidates = entries.filter((e) => e.defer === 'auto')

  const autoCost = await estimateAutoTokens(autoCandidates)
  const autoOverflowsThreshold = autoCost > threshold
  const autoPoolBigEnough = autoCandidates.length >= MIN_AUTO_DEFER_COUNT
  const autoSavingsBeatOverhead = autoCost > META_TOOLS_OVERHEAD_TOKENS
  const autoDeferred = autoOverflowsThreshold && autoPoolBigEnough && autoSavingsBeatOverhead ? autoCandidates : []

  const deferredNames = new Set([...alwaysDeferred, ...autoDeferred].map((e) => e.name))

  return { deferredNames, threshold }
}

/**
 * Token cost of the auto-defer pool as the model sees it — name + `tool.description` +
 * the canonical JSONSchema of `tool.inputSchema`. `serializeToolSchema` normalizes Zod /
 * `jsonSchema()` wrappers to the exact schema the model receives (undefined on failure →
 * name+description only), and `countToolTokens` shares the tokenizer with the gateway
 * `count_tokens` estimator so both agree.
 */
async function estimateAutoTokens(entries: readonly ToolEntry[]): Promise<number> {
  const perEntry = await Promise.all(
    entries.map(async (entry) => {
      const tool = entry.tool as { description?: string; inputSchema?: unknown }
      const schema = await serializeToolSchema(tool.inputSchema)
      return countToolTokens({ name: entry.name, description: tool.description, schema }, tokenxTokenizer)
    })
  )
  return perEntry.reduce((sum, tokens) => sum + tokens, 0)
}
