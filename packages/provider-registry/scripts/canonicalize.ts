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
  stripDateSnapshot,
  stripQuantization,
  stripVariantSuffixes
} from '../src/utils/normalize'

// strip the same org/host routing prefixes the runtime resolver does (zai-org-, databricks-, …),
// so a host that flattens `zai-org/glm-5` → `zai-org-glm-5` folds into the real `glm-5`; then peel the
// bedrock cross-vendor `[region.]vendor.` / `vendor-` prefix (shared with the runtime).
const base = (id: string) => stripBedrockVendorPrefix(stripAggregatorPrefixes(id.toLowerCase().split('/').pop()!))

// Minus param-size stripping — the catalog keeps `qwen3-235b` ≠ `qwen3-30b`. Order matters: strip the
// `-thinking`/`-free` variant BEFORE the date so the date ends the token.
export const canonOf = (id: string): string => {
  let s = base(id) // split('/').pop, lowercase, strip aggregator + bedrock-vendor prefix
  s = stripBedrockRevision(s) // bedrock arn revision: claude-…-v1:0 / …:0 (keeps whisper-v3)
  s = expandKnownPrefixes(s) // mm- → minimax-
  s = stripVariantSuffixes(s) // -free / -thinking / -tee / -low / :free / (free) …
  s = stripQuantization(s) // -fp8 / -fp16 / -awq …
  s = stripDateSnapshot(s) // trailing release-date stamps + @tag (shared with the runtime resolver)
  s = normalizeVersionSeparators(s) // 4.6 → 4-6
  return s
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// a `-` OR a digit ends the prefix word, so `qwen` claims both `qwen-max` and `qwen3-30b-a3b`
export const prefixHit = (id: string, p: string): boolean =>
  id === p || id.startsWith(`${p}-`) || (id.startsWith(p) && /\d/.test(id[p.length] ?? ''))
