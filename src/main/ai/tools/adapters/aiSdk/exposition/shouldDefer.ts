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

  const autoDeferred = await resolveAutoDeferred(autoCandidates, threshold)
  const deferredNames = new Set([...alwaysDeferred, ...autoDeferred].map((e) => e.name))

  return { deferredNames, threshold }
}

/**
 * Whether the auto pool is worth deferring. Returns `[]` for a pool below the minimum count
 * **without serializing any schema** — under `MIN_AUTO_DEFER_COUNT` the meta-tools round-trip
 * can never pay off, so the (async, per-tool) cost estimate is pure waste there.
 */
async function resolveAutoDeferred(
  autoCandidates: readonly ToolEntry[],
  threshold: number
): Promise<readonly ToolEntry[]> {
  if (autoCandidates.length < MIN_AUTO_DEFER_COUNT) return []
  const autoCost = await estimateAutoTokens(autoCandidates)
  return autoCost > threshold && autoCost > META_TOOLS_OVERHEAD_TOKENS ? autoCandidates : []
}

/**
 * Token cost of the auto-defer pool — name + `tool.description` + the canonical JSONSchema of
 * `tool.inputSchema`. `serializeToolSchema` normalizes Zod / `jsonSchema()` wrappers to the
 * exact schema the model receives (undefined on failure → name+description only). It shares
 * `countToolTokens` (schema normalization + per-tool formula) with the gateway estimator, but
 * deliberately uses `tokenx` — this is a defer/inline *gate*, not a budget, so it does not need
 * the gateway's per-dialect BPE tokenizer (o200k etc.) and their absolute counts may differ.
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
