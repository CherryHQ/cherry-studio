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

export const COLON_VARIANT_SUFFIXES = [':free', ':nitro', ':extended', ':beta', ':preview', ':thinking', ':exacto']

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
  return modelId.replace(/(\d)[,.p](?=\d)/g, '$1-')
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
  baseName = stripParameterSize(baseName)
  baseName = normalizeVersionSeparators(baseName)
  return baseName
}
