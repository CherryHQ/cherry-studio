/**
 * Build-time canonicalization — the id-folding the catalog generator applies to every model id.
 * Shares the runtime resolver's `normalizeModelId` helpers but is INTENTIONALLY different in one way:
 * it does NOT strip parameter size, so the catalog keeps `qwen3-235b` ≠ `qwen3-30b`.
 *
 * Lives in its own module (not inside `generate-catalog.ts`, whose import runs the generation IIFE) so
 * tests can import `canonOf` without triggering a live upstream fetch.
 */
import {
  expandKnownPrefixes,
  normalizeVersionSeparators,
  stripAggregatorPrefixes,
  stripBedrockRevision,
  stripBedrockVendorPrefix,
  stripVariantQuantDateSuffixes
} from '../src/utils/normalize'

// strip the same org/host routing prefixes the runtime resolver does (zai-org-, databricks-, …),
// so a host that flattens `zai-org/glm-5` → `zai-org-glm-5` folds into the real `glm-5`; then peel the
// bedrock cross-vendor `[region.]vendor.` / `vendor-` prefix (shared with the runtime).
const base = (id: string) => stripBedrockVendorPrefix(stripAggregatorPrefixes(id.toLowerCase().split('/').pop()!))

// Minus param-size stripping — the catalog keeps `qwen3-235b` ≠ `qwen3-30b`.
export const canonOf = (id: string): string => {
  let s = base(id) // split('/').pop, lowercase, strip aggregator + bedrock-vendor prefix
  s = stripBedrockRevision(s) // bedrock arn revision: claude-…-v1:0 / …:0 (keeps whisper-v3)
  s = expandKnownPrefixes(s) // mm- → minimax-
  s = stripVariantQuantDateSuffixes(s) // variant/quant/date suffixes, iterated to a fixpoint
  s = normalizeVersionSeparators(s) // 4.6 → 4-6
  return s
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// a `-` OR a digit ends the prefix word, so `qwen` claims both `qwen-max` and `qwen3-30b-a3b`
export const prefixHit = (id: string, p: string): boolean =>
  id === p || id.startsWith(`${p}-`) || (id.startsWith(p) && /\d/.test(id[p.length] ?? ''))

/**
 * A provider override that doesn't spell `apiModelId` authors `modelId` as the id the provider
 * actually serves (`glm-5.2`, `doubao-seed-2-1-pro-260628`): split it into the canonical catalog key
 * plus the wire id. The runtime sends `apiModelId ?? modelId`, so without the split the canonical
 * spelling (`glm-5-2`) goes on the wire and 404s. A row that already spells `apiModelId` keeps its
 * authored key — canonicalizing those would merge rows the author kept distinct.
 */
export const splitOverrideWireId = <T extends { modelId?: string; apiModelId?: string }>(override: T): T => {
  // `modelId` is required by the schema but the source type is Partial<>, so an authoring slip reaches
  // here as undefined — pass it through and let schema validation report it, rather than crashing.
  if (override.apiModelId || !override.modelId) return override
  const canonical = canonOf(override.modelId)
  if (!canonical || canonical === override.modelId) return override
  return { ...override, modelId: canonical, apiModelId: override.modelId }
}
