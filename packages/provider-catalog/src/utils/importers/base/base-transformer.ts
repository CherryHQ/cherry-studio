/**
 * Base transformer interface and OpenAI-compatible base class
 * Provides structure for transforming provider API responses to internal ModelConfig
 */

import type { ModelCapabilityType, ModelConfig } from '../../../schemas'
import { MODALITY, type Modality, MODEL_CAPABILITY } from '../../../schemas/enums'

/**
 * Generic transformer interface
 */
export interface ITransformer<TInput = any> {
  /**
   * Transform API model to internal ModelConfig
   */
  transform(apiModel: TInput): ModelConfig

  /**
   * Optional: Validate API response structure
   */
  validate?(response: any): boolean

  /**
   * Optional: Extract models array from response
   */
  extractModels?(response: any): TInput[]
}

/**
 * Known model ID patterns to original publisher mapping
 * Used by all transformers to determine the original model creator
 */
export const MODEL_TO_PUBLISHER: [RegExp, string][] = [
  // Anthropic Claude models
  [/^claude/, 'anthropic'],
  // OpenAI models (including text-embedding-ada, text-embedding-3-*)
  [/^(gpt-|o1|o3|o4|chatgpt|dall-e|whisper|tts-|sora|text-embedding-ada|text-embedding-3|babbage|davinci)/, 'openai'],
  // Google models (including text-embedding-004, text-embedding-005)
  [/^(gemini|palm|gemma|veo|imagen|learnlm|text-embedding-00|text-multilingual-embedding-00|nano-banana)/, 'google'],
  // Alibaba/Qwen models (including text-embedding-v*)
  [/^(qwen|qvq|qwq|wan|text-embedding-v|gte)/, 'alibaba'],
  // Meta models
  [/^llama/, 'meta'],
  // Mistral models
  [/^(voxtral|devstral|mistral|mixtral|codestral|ministral|pixtral|magistral)/, 'mistral'],
  // DeepSeek models
  [/^deepseek/, 'deepseek'],
  // Cohere models
  [/^(command|embed-|rerank-)/, 'cohere'],
  // xAI Grok models
  [/^grok/, 'xai'],
  // Microsoft Phi models
  [/^phi-/, 'microsoft'],
  // 01.ai Yi models
  [/^yi-/, '01ai'],
  // Zhipu GLM models
  [/^(glm|cogview|cogvideo)/, 'zhipu'],
  // Stability AI models
  [/^(stable-|sd3|sdxl)/, 'stability'],
  // Perplexity models
  [/^(sonar|pplx-)/, 'perplexity'],
  // Amazon models
  [/^nova-/, 'amazon'],
  // Baidu ERNIE models
  [/^ernie/, 'baidu'],
  // Moonshot/Kimi models
  [/^(moonshot|kimi)/, 'moonshot'],
  // 360 models
  [/^360/, '360ai'],
  // ByteDance Doubao models
  [/^(doubao|seed|ui-tars)/, 'bytedance'],
  // MiniMax models
  [/^(abab|minimax)/, 'minimax'],
  // Baichuan models
  [/^baichuan/, 'baichuan'],
  // Nvidia models
  [/^(nvidia|nemotron)/, 'nvidia'],
  // AI21 models
  [/^jamba/, 'ai21'],
  // Inflection models
  [/^inflection/, 'inflection'],
  // Voyage models
  [/^voyage/, 'voyage'],
  // Jina models
  [/^jina/, 'jina'],
  // BGE models (BAAI)
  [/^bge/, 'baai'],
  // StreamLake modelsp
  [/^kat/, 'streamlake'],
  // allenai models
  [/^(olmo|molmo)/, 'ai2'],
  [/^(flux)/, 'bfl'],
  [/^(lfm)/, 'liquidai'],
  [/^(longcat)/, 'meituan'],
  [/^(trinity|spotlight|virtuoso|coder-large)/, 'arceeai'],
  [/^(solar)/, 'upstageai'],
  [/^(step)/, 'stepfun'],
  [/^(ling|ring)/, 'bailing'],
  [/^cogito/, 'cogito'],
  [/^rnj/, 'essentialai'],
  [/^dolphin/, 'dolphinai'],
  [/^ideogram/, 'ideogram'],
  [/^hunyuan/, 'tencent'],
  [/^morph/, 'morph'],
  [/^mercury/, 'inception'],
  [/^(hermes|deephermes)/, 'nousresearch'],
  [/^recraft/, 'recraft'],
  [/^runway/, 'runway'],
  [/^eleven/, 'elevenlabs'],
  [/^relace/, 'relace'],
  [/^riverflow/, 'sourceful'],
  [/^sensenova/, 'sensenova'],
  [/^intern/, 'intern'],
  [/^kling/, 'kling'],
  [/^vidu/, 'vidu'],
  [/^suno/, 'suno'],
  [/^sonar/, 'perplexity'],
  [/^kolors/, 'kolors'],
  [/^megrez/, 'infini'],
  [/^aion/, 'aion']
]

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Detection Patterns (match + exclude)
// Each entry: [matchRegex, excludeRegex | null, capability]
// Based on renderer-layer detection logic in src/renderer/src/config/models/
// ═══════════════════════════════════════════════════════════════════════════════

/** Reasoning model detection — based on renderer reasoning.ts REASONING_REGEX + model checks */
const REASONING_MATCH =
  /^(?!.*\bnon-reasoning\b)(o\d+(?:-[\w-]+)?$|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-r\d+.*|.*\bqwq\b.*|.*\bqvq\b.*|.*\bhunyuan-t1\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast|4-1)(?:-[\w-]+)?\b.*|.*\bclaude-(?:3-7|sonnet-4|opus-4|haiku-4)\b.*|.*\bgemini-(?:2-5|3-)(?!.*image).*|.*\bdoubao-(?:seed-1-[68]|1-5-thinking|seed-code)\b.*|.*\bdeepseek-(?:v3|chat)\b.*|.*\bbaichuan-m[23]\b.*|.*\bminimax-m[12]\b.*|.*\bstep-[r3]\b.*|.*\bmagistral\b.*|.*\bmimo-v2\b.*|.*\bsonar-deep-research\b.*)/i
const REASONING_EXCLUDE = /\b(embed|rerank|dall-e|stable-diffusion|whisper|tts-|sdxl|flux|cogview|imagen)\b/i

/** Function calling detection — based on renderer tooluse.ts FUNCTION_CALLING_MODELS */
const FUNCTION_CALL_MATCH =
  /\b(?:gpt-4o|gpt-4-|gpt-4[.-][15]|gpt-5|o[134](?:-[\w-]+)?|claude|qwen[23]?(?:-[\w-]+)?|hunyuan|deepseek|glm-4|gemini-(?:2|3|flash|pro)|grok-[34]|doubao-seed|kimi-k2|minimax-m2|mimo-v2|mistral-large|llama-4)/i
const FUNCTION_CALL_EXCLUDE =
  /\b(?:o1-mini|o1-preview|gemini-1[.-]|imagen|aqa|qwen-mt|gpt-5-chat|glm-4[.-]5v|deepseek-v3[.-]2-speciale|embed|rerank|dall-e|stable-diffusion|whisper|tts-|sdxl|flux|cogview)\b/i

/** Vision/image recognition detection — based on renderer vision.ts visionAllowedModels */
const VISION_MATCH =
  /(-vision|-vl\b|-visual|vision-|vl-|4v|\bllava\b|\bminicpm\b|\bpixtral\b|\binternvl|\bgpt-4o\b|\bgpt-4-(?!32k|base)\b|\bgpt-4[.-][15]\b|\bgpt-5\b|\bo[134](?:-[\w-]+)?$|\bclaude-(?:3|haiku-4|sonnet-4|opus-4)\b|\bgemini-(?:1-5|2|3-(?:flash|pro))\b|\bgemma-?3\b|\bqwen(?:2|2[.-]5|3)-vl\b|\bqwen(?:2[.-]5|3)-omni\b|\bgrok-(?:4|vision)\b|\bdoubao-seed-1-[68]\b|\bkimi-(?:latest|vl|thinking)\b|\bllama-4\b)/i
const VISION_EXCLUDE =
  /\b(?:gpt-4-\d+-preview|gpt-4-turbo-preview|gpt-4-32k|gpt-4o-image|gpt-image|o1-mini|o3-mini|o1-preview|embed|rerank|dall-e|stable-diffusion|sd3|sdxl|flux|cogview|imagen|midjourney|ideogram|sora|runway|pika|kling|veo|vidu|wan|whisper|tts-)\b/i

/** Web search detection — models with built-in or API-supported web search */
const WEB_SEARCH_MATCH =
  /(-search\b|-online\b|searchgpt|\bsonar\b|\bgpt-4o\b|\bgpt-4[.-]1\b|\bgpt-4[.-]5\b|\bgpt-5\b|\bo[34](?:-[\w-]+)?$|\bclaude-(?:3-[57]-sonnet|3-5-haiku|sonnet-4|opus-4|haiku-4)\b|\bgemini-(?:2(?!.*image-preview).*|3-(?:flash|pro))\b|\bgrok-)/i
const WEB_SEARCH_EXCLUDE =
  /\b(?:gpt-4o-image|gpt-4[.-]1-nano|embed|rerank|dall-e|stable-diffusion|whisper|tts-|sdxl|flux|cogview|imagen)\b/i

/** File/document input detection — only models whose name definitively indicates file/doc processing
 * Most FILE_INPUT capability comes from:
 *   1. models.dev `attachment` field (modelsdev/transformer.ts)
 *   2. Provider-level overrides (generate-provider-models.ts) for OpenAI/Anthropic/Google
 * This regex is intentionally narrow — only models with document-specific naming */
const FILE_INPUT_MATCH = /\b(?:qwen-(?:long|doc)\b|[-_]ocr\b)/i

/** Computer use detection — models with API-supported computer/desktop interaction
 * Anthropic: claude-sonnet-4, claude-opus-4, claude-3-7-sonnet, claude-3-5-sonnet (beta)
 * OpenAI: computer-use-preview (CUA via Responses API) */
const COMPUTER_USE_MATCH = /\b(?:claude-(?:sonnet-4|opus-4|3-[57]-sonnet|haiku-4)|computer-use)/i
const COMPUTER_USE_EXCLUDE = /\b(?:embed|rerank|tts-|dall-e|stable-diffusion|sdxl|flux|cogview|imagen|whisper)\b/i

/**
 * Model ID patterns that indicate specific capabilities
 * Format: [matchRegex, excludeRegex | null, capability]
 * Used to infer capabilities from model naming conventions
 */
export const CAPABILITY_PATTERNS: [RegExp, RegExp | null, ModelCapabilityType][] = [
  // Reasoning/thinking models
  [REASONING_MATCH, REASONING_EXCLUDE, MODEL_CAPABILITY.REASONING],
  // Function calling
  [FUNCTION_CALL_MATCH, FUNCTION_CALL_EXCLUDE, MODEL_CAPABILITY.FUNCTION_CALL],
  // Embedding models
  [/(embed|embedding|bge-|e5-|gte-)/, null, MODEL_CAPABILITY.EMBEDDING],
  // Reranker models
  [/(rerank|reranker)/, null, MODEL_CAPABILITY.RERANK],
  // Vision/multimodal models
  [VISION_MATCH, VISION_EXCLUDE, MODEL_CAPABILITY.IMAGE_RECOGNITION],
  // File/document input (PDF, etc.) — narrow regex, most detection via models.dev + provider overrides
  [FILE_INPUT_MATCH, null, MODEL_CAPABILITY.FILE_INPUT],
  // Image generation models
  [/(dall-e|stable-diffusion|sd3|sdxl|flux|image|imagen|midjourney|ideogram)/, null, MODEL_CAPABILITY.IMAGE_GENERATION],
  // Video generation models
  [/(sora|runway|pika|kling|veo|luma|gen-3|video|vidu|wan)/, null, MODEL_CAPABILITY.VIDEO_GENERATION],
  // Audio transcription models
  [/(whisper)/, null, MODEL_CAPABILITY.AUDIO_TRANSCRIPT],
  // TTS models
  [/(tts-)/, null, MODEL_CAPABILITY.AUDIO_GENERATION],
  // Web search models
  [WEB_SEARCH_MATCH, WEB_SEARCH_EXCLUDE, MODEL_CAPABILITY.WEB_SEARCH],
  // Computer use / desktop interaction
  [COMPUTER_USE_MATCH, COMPUTER_USE_EXCLUDE, MODEL_CAPABILITY.COMPUTER_USE]
]

/**
 * Known official model aliases (from provider documentation)
 * Format: normalized model ID -> alias array
 * Only include officially documented aliases, not auto-generated ones
 */
export const OFFICIAL_ALIASES: Record<string, string[]> = {
  // Anthropic Claude 4.5 models
  'claude-sonnet-4-5-20250929': ['claude-sonnet-4-5'],
  'claude-haiku-4-5-20251001': ['claude-haiku-4-5'],
  'claude-opus-4-5-20251101': ['claude-opus-4-5'],
  // Anthropic Claude 4 models
  'claude-sonnet-4-20250514': ['claude-sonnet-4', 'claude-sonnet-4-0'],
  'claude-opus-4-20250514': ['claude-opus-4', 'claude-opus-4-0'],
  // Anthropic Claude 3.7 models
  'claude-3-7-sonnet-20250219': ['claude-3-7-sonnet', 'claude-3-7-sonnet-latest'],
  // Anthropic Claude 3.5 models
  'claude-3-5-sonnet-20241022': ['claude-3-5-sonnet', 'claude-3-5-sonnet-latest'],
  'claude-3-5-sonnet-20240620': ['claude-3-5-sonnet-v1'],
  'claude-3-5-haiku-20241022': ['claude-3-5-haiku', 'claude-3-5-haiku-latest']
}

/**
 * Common aggregator prefixes that should be stripped from model IDs
 * These are routing/deployment prefixes, not actual model name parts
 * Note: More specific prefixes must come before shorter ones (e.g., 'zai-org-' before 'zai-')
 */
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

/**
 * Known abbreviated prefixes and their canonical expansions
 * These are brand abbreviations that providers use in model IDs
 * Applied after aggregator prefix stripping to restore canonical names
 */
export const PREFIX_EXPANSIONS: [string, string][] = [
  ['mm-', 'minimax-'] // MiniMax shorthand: mm-m2-1 → minimax-m2-1
]

/**
 * Common colon-based variant suffixes (OpenRouter style)
 */
export const COLON_VARIANT_SUFFIXES = [':free', ':nitro', ':extended', ':beta', ':preview', ':thinking', ':exacto']

/**
 * Common hyphen-based variant suffixes
 * These are provider-specific deployment variants that should be stripped
 */
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
  '-tee', // Trusted Execution Environment variant
  '-cc', // Cloud compute variant
  '-fw', // Firewall/provider-specific variant
  '-di', // Provider-specific variant
  '-t', // Test/provider-specific variant
  '-reverse' // Reverse proxy variant
]

/**
 * Common parentheses-based variant suffixes
 */
export const PAREN_VARIANT_SUFFIXES = ['(free)', '(beta)', '(preview)', '(thinking)']

/**
 * Compound prefixes that protect a hyphen-based suffix from being stripped.
 * e.g., "non-" before "-reasoning" means "non-reasoning" is part of the model name,
 * not a variant suffix.
 */
const PROTECTED_COMPOUND_PREFIXES = ['non', 'no', 'pre', 'anti', 'post']

/**
 * Normalize version separators in model IDs
 * Converts comma, dot, and 'p' separators to hyphen (-)
 * Existing hyphens are left unchanged to avoid date pattern issues
 *
 * IMPORTANT: Call this AFTER stripping parameter sizes to avoid
 * converting decimal parameter sizes like 1.5b to 1-5b
 *
 * Examples:
 *   - gpt-3,5-turbo → gpt-3-5-turbo
 *   - gpt-3p5-turbo → gpt-3-5-turbo
 *   - claude-3.5-sonnet → claude-3-5-sonnet (dot to hyphen)
 *   - claude-3-5-sonnet → claude-3-5-sonnet (unchanged)
 *   - deepseek-r1-0728 → deepseek-r1-0728 (unchanged, date pattern)
 */
export function normalizeVersionSeparators(modelId: string): string {
  // Normalize comma, dot, and 'p' separators between digits to hyphen
  // Uses lookahead so the trailing digit isn't consumed, allowing overlapping matches
  // e.g., "4.0.1" → "4-0-1" (without lookahead, "4.0.1" → "4-0.1" because "0" is consumed)
  return modelId.replace(/(\d)[,.p](?=\d)/g, '$1-')
}

/**
 * Parameter size pattern: matches Xb or X.Xb where X is a number
 * Must be preceded by a hyphen and optionally followed by hyphen+suffix or end of string
 * Examples: -72b, -7b, -1.5b, -72b-instruct
 */
const PARAMETER_SIZE_PATTERN = /-(\d+(?:\.\d+)?b)(?=-|$)/i

/**
 * Extract parameter size suffix from model ID
 * Returns the parameter size (e.g., "72b", "7b", "1.5b") or undefined if not found
 *
 * Examples:
 *   - qwen-2.5-72b → "72b"
 *   - llama-3.1-70b-instruct → "70b"
 *   - qwen-2.5-1.5b → "1.5b"
 *   - gpt-4o → undefined
 */
export function extractParameterSize(modelId: string): string | undefined {
  const match = modelId.match(PARAMETER_SIZE_PATTERN)
  return match ? match[1].toLowerCase() : undefined
}

/**
 * Strip parameter size suffix from model ID
 * Removes the parameter size but keeps other suffixes like -instruct, -chat
 *
 * Examples:
 *   - qwen-2.5-72b → qwen-2.5
 *   - llama-3.1-70b-instruct → llama-3.1-instruct
 *   - gpt-4o → gpt-4o (unchanged)
 */
export function stripParameterSize(modelId: string): string {
  return modelId.replace(PARAMETER_SIZE_PATTERN, '')
}

/**
 * Infer publisher from a normalized model ID using MODEL_TO_PUBLISHER patterns
 */
export function inferPublisherFromModelId(normalizedModelId: string): string | undefined {
  const lowerId = normalizedModelId.toLowerCase()
  for (const [pattern, publisher] of MODEL_TO_PUBLISHER) {
    if (pattern.test(lowerId)) {
      return publisher
    }
  }
  return undefined
}

/**
 * Infer capabilities from model ID using CAPABILITY_PATTERNS
 * Each pattern has an optional exclude regex to prevent false positives
 */
export function inferCapabilitiesFromModelId(modelId: string): ModelCapabilityType[] {
  const caps: ModelCapabilityType[] = []
  const lowerId = modelId.toLowerCase()

  for (const [match, exclude, capability] of CAPABILITY_PATTERNS) {
    if (match.test(lowerId) && (!exclude || !exclude.test(lowerId))) {
      caps.push(capability)
    }
  }

  return caps
}

/**
 * Get official aliases for a normalized model ID
 */
export function getOfficialAliases(normalizedModelId: string): string[] | undefined {
  return OFFICIAL_ALIASES[normalizedModelId]
}

/**
 * Map raw modality strings to internal Modality type
 * Handles common variations in modality naming
 */
export function mapModalityString(modality: string): Modality | undefined {
  const normalized = modality.toLowerCase().trim()

  switch (normalized) {
    case 'text':
      return MODALITY.TEXT
    case 'image':
      return MODALITY.IMAGE
    case 'audio':
      return MODALITY.AUDIO
    case 'video':
      return MODALITY.VIDEO
    case 'embedding':
    case 'embeddings':
      return MODALITY.VECTOR
    default:
      return undefined
  }
}

/**
 * Map an array of modality strings to internal Modality array
 * Defaults to ['TEXT'] if no valid modalities found
 */
export function mapModalities(modalityList: string[]): Modality[] {
  const modalities = new Set<Modality>()

  for (const m of modalityList) {
    const mapped = mapModalityString(m)
    if (mapped) {
      modalities.add(mapped)
    }
  }

  const result = Array.from(modalities)
  return result.length > 0 ? result : [MODALITY.TEXT]
}

/**
 * Normalize a model ID to its canonical form:
 * 1. Strip provider prefix (e.g., "anthropic/claude-3" -> "claude-3")
 * 2. Convert to lowercase
 * 3. Strip aggregator prefixes (zai-xxx -> xxx)
 * 4. Strip variant suffixes (:free, -free, etc.)
 * 5. Strip parameter size suffix (72b, 7b, 1.5b) - BEFORE version normalization
 * 6. Normalize version separators (3.5, 3,5, 3p5 → 3-5)
 *
 * This is the single source of truth for model ID normalization.
 * All parsers and scripts should use this function.
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

/**
 * Strip aggregator prefixes from a model ID
 */
export function stripAggregatorPrefixes(modelId: string, additionalPrefixes: string[] = []): string {
  const allPrefixes = [...additionalPrefixes, ...COMMON_AGGREGATOR_PREFIXES]
  let result = modelId

  for (const prefix of allPrefixes) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length)
      break // Only remove one prefix
    }
  }

  return result
}

/**
 * Expand known abbreviated prefixes to their canonical form
 * e.g., mm-m2-1 → minimax-m2-1
 */
export function expandKnownPrefixes(modelId: string): string {
  for (const [abbrev, canonical] of PREFIX_EXPANSIONS) {
    if (modelId.startsWith(abbrev)) {
      return canonical + modelId.slice(abbrev.length)
    }
  }
  return modelId
}

/**
 * Strip variant suffixes from a model ID
 * Handles colon-based (:free), hyphen-based (-free), and parentheses-based ((free)) suffixes
 */
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

  // Don't strip if it's an official model
  if (officialModels.has(modelId)) {
    return modelId
  }

  // Strip colon-based suffixes
  const colonIdx = modelId.lastIndexOf(':')
  if (colonIdx > 0) {
    const suffix = modelId.slice(colonIdx)
    if (colonSuffixes.includes(suffix)) {
      return modelId.slice(0, colonIdx)
    }
  }

  // Strip hyphen-based suffixes
  // Protect compound modifiers like "non-reasoning", "non-thinking" from being stripped
  for (const suffix of hyphenSuffixes) {
    if (modelId.endsWith(suffix)) {
      const remaining = modelId.slice(0, -suffix.length)
      if (PROTECTED_COMPOUND_PREFIXES.some((p) => remaining.endsWith(p))) {
        continue
      }
      return remaining
    }
  }

  // Strip parentheses-based suffixes (with optional space before)
  for (const suffix of parenSuffixes) {
    if (modelId.endsWith(suffix)) {
      let result = modelId.slice(0, -suffix.length)
      // Also strip trailing space if present
      if (result.endsWith(' ')) {
        result = result.slice(0, -1)
      }
      return result
    }
  }

  return modelId
}

/**
 * Extract variant suffix from a model ID
 * Returns the suffix without the leading character (: or - or parentheses)
 */
export function extractVariantSuffix(
  modelId: string,
  options: {
    colonSuffixes?: string[]
    hyphenSuffixes?: string[]
    parenSuffixes?: string[]
    officialModelsWithSuffix?: Set<string>
  } = {}
): string | undefined {
  const colonSuffixes = options.colonSuffixes ?? COLON_VARIANT_SUFFIXES
  const hyphenSuffixes = options.hyphenSuffixes ?? HYPHEN_VARIANT_SUFFIXES
  const parenSuffixes = options.parenSuffixes ?? PAREN_VARIANT_SUFFIXES
  const officialModels = options.officialModelsWithSuffix ?? new Set<string>()

  const lowerModelId = modelId.toLowerCase()

  // Don't extract variant for official models
  if (officialModels.has(lowerModelId)) {
    return undefined
  }

  // Check colon-based suffixes
  const colonIdx = lowerModelId.lastIndexOf(':')
  if (colonIdx > 0) {
    const suffix = lowerModelId.slice(colonIdx)
    if (colonSuffixes.includes(suffix)) {
      return suffix.slice(1) // Remove leading ':'
    }
  }

  // Check hyphen-based suffixes
  for (const suffix of hyphenSuffixes) {
    if (lowerModelId.endsWith(suffix)) {
      const remaining = lowerModelId.slice(0, -suffix.length)
      if (PROTECTED_COMPOUND_PREFIXES.some((p) => remaining.endsWith(p))) {
        continue
      }
      return suffix.slice(1) // Remove leading '-'
    }
  }

  // Check parentheses-based suffixes (with optional space before)
  for (const suffix of parenSuffixes) {
    if (lowerModelId.endsWith(suffix) || lowerModelId.endsWith(' ' + suffix)) {
      // Return content without parentheses: "(free)" -> "free"
      return suffix.slice(1, -1)
    }
  }

  return undefined
}

/**
 * Base class for OpenAI-compatible transformers
 * Handles common patterns like extracting { data: [...] } responses
 */
export class OpenAICompatibleTransformer implements ITransformer {
  /**
   * Default implementation extracts from { data: [...] } or direct array
   */
  extractModels(response: any): any[] {
    if (Array.isArray(response.data)) {
      return response.data
    }
    if (Array.isArray(response)) {
      return response
    }
    throw new Error('Invalid API response structure: expected { data: [] } or []')
  }

  /**
   * Default transformation for OpenAI-compatible model responses
   * Minimal transformation - most fields are optional
   */
  transform(apiModel: any): ModelConfig {
    // Normalize model ID to lowercase
    const modelId = (apiModel.id || apiModel.model || '').toLowerCase()

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    return {
      id: modelId,
      name: apiModel.name || modelId,
      description: apiModel.description,

      capabilities: this.inferCapabilities(apiModel),
      inputModalities: [MODALITY.TEXT], // Default to text
      outputModalities: [MODALITY.TEXT], // Default to text

      contextWindow: apiModel.context_length || apiModel.context_window || undefined,
      maxOutputTokens: apiModel.max_tokens || apiModel.max_output_tokens || undefined,

      pricing: this.extractPricing(apiModel),

      metadata: {
        source: 'api',
        owned_by: apiModel.owned_by,
        tags: apiModel.tags || [],
        created: apiModel.created,
        updated: apiModel.updated
      }
    }
  }

  /**
   * Infer basic capabilities from model data
   */
  protected inferCapabilities(apiModel: any): ModelCapabilityType[] | undefined {
    const capabilities: ModelCapabilityType[] = []

    // Check for common capability indicators
    if (apiModel.supports_tools || apiModel.function_calling) {
      capabilities.push(MODEL_CAPABILITY.FUNCTION_CALL)
    }
    if (apiModel.supports_vision || apiModel.vision) {
      capabilities.push(MODEL_CAPABILITY.IMAGE_RECOGNITION)
    }
    if (apiModel.supports_json_output || apiModel.response_format) {
      capabilities.push(MODEL_CAPABILITY.STRUCTURED_OUTPUT)
    }

    return capabilities.length > 0 ? capabilities : undefined
  }

  /**
   * Extract pricing if available
   */
  protected extractPricing(apiModel: any): ModelConfig['pricing'] {
    if (!apiModel.pricing) return undefined

    const pricing = apiModel.pricing

    // Handle per-token pricing (convert to per-million)
    if (pricing.prompt !== undefined && pricing.completion !== undefined) {
      const inputCost = parseFloat(pricing.prompt)
      const outputCost = parseFloat(pricing.completion)

      if (inputCost <= 0 || outputCost <= 0) return undefined

      return {
        input: { perMillionTokens: inputCost * 1_000_000 },
        output: { perMillionTokens: outputCost * 1_000_000 }
      }
    }

    // Handle direct per-million pricing
    if (
      pricing.input?.perMillionTokens != null &&
      pricing.output?.perMillionTokens != null &&
      !isNaN(pricing.input.perMillionTokens) &&
      !isNaN(pricing.output.perMillionTokens)
    ) {
      return {
        input: { perMillionTokens: pricing.input.perMillionTokens },
        output: { perMillionTokens: pricing.output.perMillionTokens }
      }
    }

    return undefined
  }
}

/**
 * Abstract base class for catalog transformers
 * Provides common functionality for normalizing model IDs, inferring publishers, etc.
 */
export abstract class BaseCatalogTransformer<TInput = any> implements ITransformer<TInput> {
  /**
   * Additional aggregator prefixes specific to this transformer
   * Override in subclasses to add provider-specific prefixes
   */
  protected readonly aggregatorPrefixes: string[] = []

  /**
   * Colon-based variant suffixes to strip
   * Override in subclasses to customize
   */
  protected readonly colonVariantSuffixes: string[] = COLON_VARIANT_SUFFIXES

  /**
   * Hyphen-based variant suffixes to strip
   * Override in subclasses to customize
   */
  protected readonly hyphenVariantSuffixes: string[] = HYPHEN_VARIANT_SUFFIXES

  /**
   * Official models that have suffix-like endings but should NOT be stripped
   * Override in subclasses to customize
   */
  protected readonly officialModelsWithSuffix: Set<string> = new Set()

  /**
   * Transform API model to internal ModelConfig
   * Must be implemented by subclasses
   */
  abstract transform(apiModel: TInput): ModelConfig

  /**
   * Normalize a model ID by:
   * 1. Removing provider prefix (e.g., "anthropic/claude-3" -> "claude-3")
   * 2. Removing aggregator prefixes
   * 3. Stripping variant suffixes
   * 4. Stripping parameter size suffix (72b, 7b, 1.5b) - BEFORE version normalization
   * 5. Normalizing version separators (3.5, 3,5, 3p5 → 3-5)
   * 6. Converting to lowercase
   */
  protected normalizeModelId(modelId: string): string {
    // Split by '/' and take the last part
    const parts = modelId.split('/')
    let baseName = parts[parts.length - 1].toLowerCase()

    // Remove aggregator prefixes
    baseName = stripAggregatorPrefixes(baseName, this.aggregatorPrefixes)

    // Expand known abbreviated prefixes (e.g., mm- → minimax-)
    baseName = expandKnownPrefixes(baseName)

    // Strip variant suffixes
    baseName = stripVariantSuffixes(baseName, {
      colonSuffixes: this.colonVariantSuffixes,
      hyphenSuffixes: this.hyphenVariantSuffixes,
      officialModelsWithSuffix: this.officialModelsWithSuffix
    })

    // Strip parameter size suffix BEFORE version normalization
    // This preserves decimal parameter sizes like 1.5b
    baseName = stripParameterSize(baseName)

    // Normalize version separators (e.g., claude-3.5 → claude-3-5)
    baseName = normalizeVersionSeparators(baseName)

    return baseName
  }

  /**
   * Extract parameter size from model ID
   * Returns the size (e.g., "72b") or undefined
   */
  protected getParameterSize(modelId: string): string | undefined {
    // Normalize version first, then extract parameter size
    const normalized = normalizeVersionSeparators(modelId.toLowerCase())
    return extractParameterSize(normalized)
  }

  /**
   * Infer the original model publisher from model ID
   */
  protected inferPublisher(modelId: string): string | undefined {
    return inferPublisherFromModelId(modelId)
  }

  /**
   * Get variant suffix from model ID if present
   */
  protected getModelVariant(modelId: string): string | undefined {
    return extractVariantSuffix(modelId, {
      colonSuffixes: this.colonVariantSuffixes,
      hyphenSuffixes: this.hyphenVariantSuffixes,
      officialModelsWithSuffix: this.officialModelsWithSuffix
    })
  }

  /**
   * Get official aliases for a model ID
   */
  protected getAlias(modelId: string): string[] | undefined {
    const normalizedId = this.normalizeModelId(modelId)
    return getOfficialAliases(normalizedId)
  }

  /**
   * Infer capabilities from model ID patterns
   */
  protected inferCapabilitiesFromId(modelId: string): ModelCapabilityType[] {
    return inferCapabilitiesFromModelId(modelId)
  }

  /**
   * Map modality strings to internal format
   */
  protected mapModalities(modalityList: string[]): Modality[] {
    return mapModalities(modalityList)
  }
}
