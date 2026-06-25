/**
 * Model ID normalization utilities.
 *
 * Extracted from base-transformer.ts so that both the importer pipeline
 * and the runtime registry lookup can share the same logic without
 * pulling in the entire importer dependency tree.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const COMMON_AGGREGATOR_PREFIXES = [
  // AIHubMix routing prefixes
  'aihubmix-',
  'aihub-',
  'ahm-',
  // Cloud provider routing
  'alicloud-',
  'azure-',
  'baidu-',
  'cbs-',
  'cc-',
  'sf-',
  's-',
  'bai-',
  'mm-',
  'web-',
  // Platform aggregators
  'deepinfra-',
  'groq-',
  'nvidia-',
  'sophnet-',
  // Legacy prefixes
  'zai-org-', // Must be before zai-
  'zai-',
  'lucidquery-',
  'lucidnova-',
  'lucid-',
  'siliconflow-',
  'chutes-',
  'huoshan-',
  'meta-',
  'cohere-',
  'coding-',
  'dmxapi-',
  'perplexity-',
  'ai21-',
  'openai-',
  // Underscore-based prefixes
  'dmxapi_',
  'aistudio_'
]

export const PREFIX_EXPANSIONS: [string, string][] = [
  ['mm-', 'minimax-'] // MiniMax shorthand: mm-m2-1 → minimax-m2-1
]

export const COLON_VARIANT_SUFFIXES = [
  ':free',
  ':nitro',
  ':extended',
  ':beta',
  ':preview',
  ':thinking',
  ':exacto',
  ':latest',
  ':cloud'
]

export const HYPHEN_VARIANT_SUFFIXES = [
  '-free',
  '-search',
  '-online',
  '-think',
  '-reasoning',
  '-classic',
  '-low',
  '-high',
  '-minimal',
  '-medium',
  '-nothink',
  '-no-think',
  '-ssvip',
  '-thinking',
  '-nothinking',
  '-aliyun',
  '-huoshan',
  '-tee',
  '-cc',
  '-fw',
  '-di',
  '-t',
  '-reverse'
]

export const PAREN_VARIANT_SUFFIXES = ['(free)', '(beta)', '(preview)', '(thinking)']

const PROTECTED_COMPOUND_PREFIXES = ['non', 'no', 'pre', 'anti', 'post']

const PARAMETER_SIZE_PATTERN = /-(\d+(?:\.\d+)?b)(?=-|$)/i

// Quantization markers denote the same logical model at a different precision
// (e.g. `glm-4-5-fp8` is `glm-4-5`). Stripping them lets the resolver collapse
// the redundant spellings a provider might return.
export const QUANTIZATION_SUFFIXES = ['-fp8', '-fp16', '-bf16', '-awq', '-int4', '-int8', '-gguf', '-gptq']

// Trailing release-date stamps (`claude-sonnet-4-5-20250929`, `gpt-4o-2024-08-06`,
// `kimi-k2-250905`) denote the same model line. Strip only UNAMBIGUOUS forms — a
// full YYYY[-]MM[-]DD or a YYMMDD with a valid month (01-12) and day (01-31) — so a
// provider's dated id resolves to the bare canonical, while sizes/versions
// (`glm-4-9b`, `qwen3-235b`) and ambiguous 4-digit stamps (YYMM `-2507`, MMDD
// `-0324`) are left untouched. The 4-digit stamps are collapsed at build time by
// the reconciler, which validates the stem against the real catalog first.
const DATE_SNAPSHOT_PATTERN =
  /-20\d{2}-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])$|-20\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$|-2\d(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$/

// ─────────────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────────────

export function stripAggregatorPrefixes(modelId: string, additionalPrefixes: string[] = []): string {
  const allPrefixes = [...additionalPrefixes, ...COMMON_AGGREGATOR_PREFIXES]
  let result = modelId

  for (const prefix of allPrefixes) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length)
      break
    }
  }

  return result
}

/**
 * Drop a leading host/org segment when the remainder is itself a real model id — no hardcoded host
 * list, the catalog is the oracle. A host re-lists someone else's model under its own name
 * (`databricks-gemini-3-flash` → `gemini-3-flash`, `cerebras-llama-4-scout` → `llama-4-scout`,
 * `z-ai-glm-5-turbo` → `glm-5-turbo`, `umans-glm-5-1` → `glm-5-1`); a brand does NOT, so
 * `deepseek-chat` / `minimax-m3` / `v0-1-5` stay (their stems `chat`/`m3`/`1-5` aren't real ids).
 * Tries one then two leading segments. `isKnownId` decides existence (registry/index membership).
 */
export function stripHostReprefix(modelId: string, isKnownId: (id: string) => boolean): string {
  const segs = modelId.split('-')
  for (let n = 1; n <= 2 && n < segs.length; n++) {
    const rest = segs.slice(n).join('-')
    if (isKnownId(rest)) return rest
  }
  return modelId
}

export function expandKnownPrefixes(modelId: string): string {
  for (const [abbrev, canonical] of PREFIX_EXPANSIONS) {
    if (modelId.startsWith(abbrev)) {
      return canonical + modelId.slice(abbrev.length)
    }
  }
  return modelId
}

export function stripVariantSuffixes(
  modelId: string,
  options: {
    colonSuffixes?: string[]
    hyphenSuffixes?: string[]
    parenSuffixes?: string[]
    officialModelsWithSuffix?: Set<string>
  } = {}
): string {
  const colonSuffixes = options.colonSuffixes ?? COLON_VARIANT_SUFFIXES
  const hyphenSuffixes = options.hyphenSuffixes ?? HYPHEN_VARIANT_SUFFIXES
  const parenSuffixes = options.parenSuffixes ?? PAREN_VARIANT_SUFFIXES
  const officialModels = options.officialModelsWithSuffix ?? new Set<string>()

  if (officialModels.has(modelId)) {
    return modelId
  }

  const colonIdx = modelId.lastIndexOf(':')
  if (colonIdx > 0) {
    const suffix = modelId.slice(colonIdx)
    if (colonSuffixes.includes(suffix)) {
      return modelId.slice(0, colonIdx)
    }
  }

  for (const suffix of hyphenSuffixes) {
    if (modelId.endsWith(suffix)) {
      const remaining = modelId.slice(0, -suffix.length)
      if (PROTECTED_COMPOUND_PREFIXES.some((p) => remaining.endsWith(p))) {
        continue
      }
      return remaining
    }
  }

  for (const suffix of parenSuffixes) {
    if (modelId.endsWith(suffix)) {
      let result = modelId.slice(0, -suffix.length)
      if (result.endsWith(' ')) {
        result = result.slice(0, -1)
      }
      return result
    }
  }

  return modelId
}

export function normalizeVersionSeparators(modelId: string): string {
  // `,` `.` `p` `_` between digits are all version separators: 3.5 / 3,5 / 3p5 / 3_5 → 3-5
  return modelId.replace(/(\d)[,._p](?=\d)/g, '$1-')
}

export function stripQuantization(modelId: string): string {
  for (const suffix of QUANTIZATION_SUFFIXES) {
    if (modelId.endsWith(suffix)) {
      return modelId.slice(0, -suffix.length)
    }
  }
  return modelId
}

export function stripDateSnapshot(modelId: string): string {
  return modelId.replace(DATE_SNAPSHOT_PATTERN, '')
}

export function extractParameterSize(modelId: string): string | undefined {
  const match = modelId.match(PARAMETER_SIZE_PATTERN)
  return match ? match[1].toLowerCase() : undefined
}

export function stripParameterSize(modelId: string): string {
  return modelId.replace(PARAMETER_SIZE_PATTERN, '')
}

/**
 * Normalize a model ID to its canonical form.
 * This is the single source of truth for model ID normalization.
 */
export function normalizeModelId(modelId: string): string {
  const parts = modelId.split('/')
  let baseName = parts[parts.length - 1].toLowerCase()
  baseName = stripAggregatorPrefixes(baseName)
  baseName = expandKnownPrefixes(baseName)
  baseName = stripVariantSuffixes(baseName)
  baseName = stripQuantization(baseName)
  baseName = stripDateSnapshot(baseName)
  baseName = stripParameterSize(baseName)
  baseName = normalizeVersionSeparators(baseName)
  // Underscores are an interchangeable separator (HF-style `bce-embedding-base_v1`). The catalog folds
  // them to `-` (every base id is dash-only), so fold here too or such ids would never resolve.
  baseName = baseName.replace(/_/g, '-')
  return baseName
}
