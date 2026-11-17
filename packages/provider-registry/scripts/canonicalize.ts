import type { Provider } from '../src/providers/types'
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

// OpenRouter's `:batch` twin uses an async endpoint the app never calls and discounted pricing.
// Drop instead of fold so it cannot claim the base model's pricing or `apiModelId`.
const BATCH_TWIN = /[:-]batch$/

// Vercel lists `openai/*-fast` gateway routes as model SKUs; they are not creator models.
// Keep real vendor `-fast` SKUs from Vercel and every other upstream source.
export const isModelsDevRoutingAlias = (provider: string, id: string): boolean =>
  provider === 'vercel' && /^openai\/.+-fast$/i.test(id)

// Minus param-size stripping — the catalog keeps `qwen3-235b` ≠ `qwen3-30b`.
// Returns `''` for an id that is not a catalog model; every intake point drops those.
export const canonOf = (id: string): string => {
  if (BATCH_TWIN.test(id.toLowerCase())) return ''
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
 * Fills a provider offer's canonical catalog key from its exact `apiModelId`. An authored `modelId` is kept,
 * so rows the author kept distinct never merge. The runtime sends `apiModelId ?? modelId`, so `apiModelId`
 * is dropped when it equals the derived key.
 */
export const deriveOverrideModelId = <T extends { modelId?: string; apiModelId: string }>({
  modelId,
  apiModelId,
  ...rest
}: T): Omit<T, 'modelId' | 'apiModelId'> & { modelId: string; apiModelId?: string } => {
  if (modelId) return { ...rest, modelId, apiModelId }
  const canonical = canonOf(apiModelId) || apiModelId
  return canonical === apiModelId ? { ...rest, modelId: canonical } : { ...rest, modelId: canonical, apiModelId }
}

/** A provider's offers (with derived keys) and models.dev templates, each addressed by catalog `modelId`. */
export const providerModelEntries = ({ overrides, modelTemplates }: Pick<Provider, 'overrides' | 'modelTemplates'>) => [
  ...(overrides ?? []).map(deriveOverrideModelId),
  ...(modelTemplates ?? [])
]
