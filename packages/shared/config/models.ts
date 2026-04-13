/**
 * Model identification and capability check functions.
 *
 * This module has two sections:
 *
 * 1. **Runtime model checks** — query Model schema fields (capabilities, reasoning,
 *    parameterSupport). These are the primary API for callers.
 *
 * 2. **Model-ID inference helpers** — string-match raw model IDs to infer
 *    capabilities. Used by modelMerger at model-creation time to populate schema
 *    fields when preset metadata is missing. Not intended for runtime use.
 */

import type { Model, RuntimeReasoning, ThinkingTokenLimits } from '@shared/data/types/model'
import type { UniqueModelId } from '@shared/data/types/model'
import { MODEL_CAPABILITY, parseUniqueModelId, UNIQUE_MODEL_ID_SEPARATOR } from '@shared/data/types/model'

// ════════════════════════════════════��═══════════════════════════════════════
// Section 1 — Runtime Model Checks (schema-driven)
// ════════════���════════════════════════════════════���══════════════════════════

// ---------------------------------------------------------------------------
// Capability checks
// ---------------------------------------------------------------------------

/** Check if model has reasoning capability */
export const isReasoningModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning != null

/** Check if model supports vision/image input */
export const isVisionModel = (model: Model): boolean => model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION)

/** Check if model supports image generation */
export const isGenerateImageModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)

/** Check if model is an embedding model */
export const isEmbeddingModel = (model: Model): boolean => model.capabilities.includes(MODEL_CAPABILITY.EMBEDDING)

/** Check if model is a reranking model */
export const isRerankModel = (model: Model): boolean => model.capabilities.includes(MODEL_CAPABILITY.RERANK)

/** Check if model supports function calling / tool use */
export const isFunctionCallingModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL)

/** Check if model supports web search */
export const isWebSearchModel = (model: Model): boolean => model.capabilities.includes(MODEL_CAPABILITY.WEB_SEARCH)

/** Check if model is a dedicated text-to-image model (no text chat) */
export const isTextToImageModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION) &&
  !model.capabilities.includes(MODEL_CAPABILITY.REASONING)

// ---------------------------------------------------------------------------
// Reasoning configuration
// ---------------------------------------------------------------------------

/** Get full reasoning config */
export const getReasoningConfig = (model: Model): RuntimeReasoning | undefined => model.reasoning

/** Get thinking token limits */
export const getThinkingTokenLimits = (model: Model): ThinkingTokenLimits | undefined =>
  model.reasoning?.thinkingTokenLimits

/** Get supported reasoning effort levels */
export const getSupportedEfforts = (model: Model): string[] | undefined => model.reasoning?.supportedEfforts

/** Whether reasoning supports interleaved thinking */
export const isInterleavedThinkingModel = (model: Model): boolean => model.reasoning?.interleaved === true

/** Check if model supports thinking token control */
export const isSupportedThinkingTokenModel = (model: Model): boolean => model.reasoning?.thinkingTokenLimits != null

/** Check if model supports reasoning effort configuration */
export const isSupportedReasoningEffortModel = (model: Model): boolean =>
  (model.reasoning?.supportedEfforts?.length ?? 0) > 0

/**
 * A fixed reasoning model: it reasons, but offers no tuning knobs.
 * No thinking-token limits and no supported efforts.
 */
export const isFixedReasoningModel = (model: Model): boolean =>
  isReasoningModel(model) && !isSupportedThinkingTokenModel(model) && !isSupportedReasoningEffortModel(model)

/** Get the reasoning effort options the UI should expose for this model */
export const getModelSupportedReasoningEffortOptions = (model: Model | undefined | null): string[] | undefined => {
  if (!model) return undefined
  return model.reasoning?.supportedEfforts
}

// ---------------------------------------------------------------------------
// Parameter support checks
// ---------------------------------------------------------------------------

/** Check if model supports temperature parameter */
export const isSupportTemperatureModel = (model: Model): boolean =>
  model.parameterSupport?.temperature?.supported !== false

/** Check if model supports top_p parameter */
export const isSupportTopPModel = (model: Model): boolean => model.parameterSupport?.topP?.supported !== false

/** Whether temperature and top_p are mutually exclusive for this model */
export const isTemperatureTopPMutuallyExclusiveModel = (model: Model): boolean => {
  // Claude 4.5 reasoning models require this constraint
  const id = getRawModelId(model)
  return /claude-(sonnet|opus|haiku)-4(-|.)5(?:-[\w-]+)?$/i.test(getLowerBaseModelName(id, '/'))
}

/** Check if model has max temperature of 1 */
export const isMaxTemperatureOneModel = (model: Model): boolean => {
  if (model.parameterSupport?.temperature) {
    return model.parameterSupport.temperature.max <= 1
  }
  // Fallback: infer from model family
  const id = getLowerBaseModelName(getRawModelId(model))
  return id.startsWith('claude') || id.includes('glm') || id.includes('kimi') || id.includes('moonshot')
}

// ---------------------------------------------------------------------------
// Model family checks (lightweight ID-based, safe for runtime)
// ---------------------------------------------------------------------------

/** Check if model is an Anthropic/Claude model */
export const isAnthropicModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).startsWith('claude')

/** Check if model is a Gemini model */
export const isGeminiModel = (model: Model): boolean => getLowerBaseModelName(getRawModelId(model)).includes('gemini')

/** Check if model is Gemini 3 series */
export const isGemini3Model = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gemini-3')

/** Check if model is a Grok model */
export const isGrokModel = (model: Model): boolean => getLowerBaseModelName(getRawModelId(model)).includes('grok')

/** Check if model is an OpenAI model (GPT or o-series) */
export const isOpenAIModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return /\bgpt\b/.test(id) || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')
}

/** Check if model is an OpenAI LLM model (excludes image-generation GPT-4o variants) */
export const isOpenAILLMModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  if (id.includes('gpt-4o-image')) return false
  return isOpenAIModel(model)
}

/** Check if model is OpenAI reasoning model (o-series, GPT-5 non-chat) */
export const isOpenAIReasoningModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return isSupportedReasoningEffortOpenAIModel(model) || id.includes('o1')
}

/** Check if model only supports chat completion (no responses API) */
export const isOpenAIChatCompletionOnlyModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return (
    id.includes('gpt-4o-search-preview') ||
    id.includes('gpt-4o-mini-search-preview') ||
    id.includes('o1-mini') ||
    id.includes('o1-preview')
  )
}

/** Check if model supports web search in chat completion mode only */
export const isOpenAIWebSearchChatCompletionOnlyModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return id.includes('gpt-4o-search-preview') || id.includes('gpt-4o-mini-search-preview')
}

/** Check if model is OpenAI deep research model (requires openai/openai-chat provider) */
export const isOpenAIDeepResearchModel = (model: Model): boolean => {
  if (model.providerId !== 'openai' && model.providerId !== 'openai-chat') return false
  return /deep[-_]?research/.test(getLowerBaseModelName(getRawModelId(model), '/'))
}

/** Check if model supports OpenAI reasoning effort */
export const isSupportedReasoningEffortOpenAIModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return (
    (id.includes('o1') && !id.includes('o1-preview') && !id.includes('o1-mini')) ||
    id.includes('o3') ||
    id.includes('o4') ||
    id.includes('gpt-oss') ||
    (id.includes('gpt-5') && !id.includes('chat'))
  )
}

/** Check if model is OpenAI open-weight model */
export const isOpenAIOpenWeightModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gpt-oss')

/** GPT-5 family (gpt-5, gpt-5.1, gpt-5.2, etc.) */
export const isGPT5FamilyModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gpt-5')

/** GPT-5 base series (not sub-versions like gpt-5.1) */
export const isGPT5SeriesModel = (model: Model): boolean =>
  /gpt-5(?!\.\d)/.test(getLowerBaseModelName(getRawModelId(model)))

export const isGPT51SeriesModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gpt-5.1')

export const isGPT52SeriesModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gpt-5.2')

export const isGPT51CodexMaxModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gpt-5.1-codex-max')

export const isGPT5ProModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gpt-5-pro')

/** GPT-5 family models support verbosity */
export const isSupportVerbosityModel = isGPT5FamilyModel

/** Check if model supports "none" reasoning effort */
export const isSupportNoneReasoningEffortModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  const isCodex = id.includes('codex')
  const isOldCodex = isCodex && (isGPT51SeriesModel(model) || isGPT52SeriesModel(model))
  return (
    isGPT5FamilyModel(model) && !isGPT5SeriesModel(model) && !id.includes('chat') && !id.includes('pro') && !isOldCodex
  )
}

/** Check if model supports flex service tier */
export const isSupportFlexServiceTierModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return (id.includes('o3') && !id.includes('o3-mini')) || id.includes('o4-mini') || id.includes('gpt-5')
}

export const isSupportedFlexServiceTier = isSupportFlexServiceTierModel

/** Check if model is Claude reasoning model (3.7-sonnet, 4-series) */
export const isClaudeReasoningModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return (
    id.includes('claude-3-7-sonnet') ||
    id.includes('claude-3.7-sonnet') ||
    id.includes('claude-sonnet-4') ||
    id.includes('claude-opus-4') ||
    id.includes('claude-haiku-4')
  )
}

/** Alias: thinking token support for Claude = Claude reasoning model */
export const isSupportedThinkingTokenClaudeModel = isClaudeReasoningModel

/** Check if model is Claude 4 series */
export const isClaude4SeriesModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return /claude-(sonnet|opus|haiku)-4(?:[.-]\d+)?(?:[@\-:][\w\-:]+)?$/i.test(id)
}

/** Check if model is Claude 4.6 series */
export const isClaude46SeriesModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return /(?:anthropic\.)?claude-(?:opus|sonnet)-4[.-]6(?:[@\-:][\w\-:]+)?$/i.test(id)
}

/** Check if model is Claude 4.5 reasoning */
export const isClaude45ReasoningModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return /claude-(sonnet|opus|haiku)-4(-|.)5(?:-[\w-]+)?$/i.test(id)
}

/** Check if model is Gemini 3 thinking token model (excluding image) */
export const isGemini3ThinkingTokenModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return isGemini3Model(model) && !id.includes('image')
}

/** Check if Gemini model supports thinking tokens */
export const isSupportedThinkingTokenGeminiModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  if (GEMINI_THINKING_MODEL_REGEX.test(id)) {
    if (id.includes('gemini-3-pro-image')) return true
    if (id.includes('image') || id.includes('tts')) return false
    return true
  }
  return false
}

/** Check if Grok model supports reasoning effort */
export const isSupportedReasoningEffortGrokModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  if (id.includes('grok-3-mini')) return true
  if (model.providerId === 'openrouter' && id.includes('grok-4-fast')) return true
  return false
}

/** Check if model is Grok 4 Fast reasoning */
export const isGrok4FastReasoningModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return id.includes('grok-4-fast') && !id.includes('non-reasoning')
}

/** Check if model is Qwen MT (machine translation) */
export const isQwenMTModel = (model: Model): boolean => getLowerBaseModelName(getRawModelId(model)).includes('qwen-mt')

/** Check if model is Qwen 3.5-3.9 series */
export const isQwen35to39Model = (model: Model): boolean =>
  /^qwen3\.[5-9]/.test(getLowerBaseModelName(getRawModelId(model), '/'))

/** Check if model is Qwen reasoning model */
export const isQwenReasoningModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  if (id.startsWith('qwen3') && id.includes('thinking')) return true
  if (isSupportedThinkingTokenQwenModel(model)) return true
  if (id.includes('qwq') || id.includes('qvq')) return true
  return false
}

/** Check if Qwen model supports thinking token control */
export const isSupportedThinkingTokenQwenModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  if (['coder', 'asr', 'tts', 'reranker', 'embedding', 'instruct', 'thinking'].some((f) => id.includes(f))) {
    return false
  }
  if (/^qwen3\.[5-9]/.test(id)) return true
  return (
    /^(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)/i.test(id) ||
    /^qwen(?:3\.[5-9])?-plus(?:-|$)/i.test(id) ||
    /^qwen(?:3\.[5-9])?-flash(?:-|$)/i.test(id) ||
    /^qwen(?:3\.[5-9])?-turbo(?:-|$)/i.test(id) ||
    /^qwen3-\d/i.test(id)
  )
}

/** Check if Qwen model always thinks (no control) */
export const isQwenAlwaysThinkModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return (id.startsWith('qwen3') && id.includes('thinking')) || (id.includes('qwen3-vl') && id.includes('thinking'))
}

/** Check if Doubao model supports thinking auto mode */
export const isDoubaoThinkingAutoModel = (model: Model): boolean =>
  DOUBAO_THINKING_AUTO_MODEL_REGEX.test(getLowerBaseModelName(getRawModelId(model)))

/** Check if Doubao model is seed after 251015 */
export const isDoubaoSeedAfter251015 = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return /doubao-seed-1-6-(?:lite-)?251015|doubao-seed-2[.-]0/i.test(id)
}

/** Check if Doubao model is seed 1.8 */
export const isDoubaoSeed18Model = (model: Model): boolean =>
  /doubao-seed-1[.-]8(?:-[\w-]+)?/i.test(getLowerBaseModelName(getRawModelId(model)))

/** Check if Doubao model supports thinking tokens */
export const isSupportedThinkingTokenDoubaoModel = (model: Model): boolean =>
  DOUBAO_THINKING_MODEL_REGEX.test(getLowerBaseModelName(getRawModelId(model), '/'))

/** Check if Hunyuan model supports thinking tokens */
export const isSupportedThinkingTokenHunyuanModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model), '/').includes('hunyuan-a13b')

/** Check if Zhipu model supports thinking tokens */
export const isSupportedThinkingTokenZhipuModel = (model: Model): boolean =>
  /glm-?5|glm-4\.[567]/.test(getLowerBaseModelName(getRawModelId(model), '/'))

/** Check if MiMo model supports thinking tokens */
export const isSupportedThinkingTokenMiMoModel = (model: Model): boolean =>
  ['mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni'].some((m) =>
    getLowerBaseModelName(getRawModelId(model), '/').includes(m)
  )

/** Check if Kimi model supports thinking tokens */
export const isSupportedThinkingTokenKimiModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('kimi-k2.5')

/** Check if model is DeepSeek hybrid inference */
export const isDeepSeekHybridInferenceModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return (
    /(\w+-)?deepseek-v3(?:\.\d|-\d)(?:(\.|-)(?!speciale$)\w+)?$/.test(id) ||
    id.includes('deepseek-chat-v3.1') ||
    id.includes('deepseek-chat')
  )
}

/** Check if model supports OpenRouter built-in web search */
export const isOpenRouterBuiltInWebSearchModel = (model: Model): boolean => {
  if (model.providerId !== 'openrouter') return false
  const id = getLowerBaseModelName(getRawModelId(model))
  return isOpenAIWebSearchChatCompletionOnlyModel(model) || id.includes('sonar')
}

/** Check if model is a pure image generation model (no tool use) */
export const isPureGenerateImageModel = (model: Model): boolean => {
  if (!isGenerateImageModel(model) && !isTextToImageModel(model)) return false
  if (isFunctionCallingModel(model)) return false
  return true
}

// ---------------------------------------------------------------------------
// Verbosity support
// ---------------------------------------------------------------------------

export const getModelSupportedVerbosity = (model: Model | undefined | null): (string | null | undefined)[] => {
  if (!model || !isSupportVerbosityModel(model)) return [undefined]

  const id = getLowerBaseModelName(getRawModelId(model))

  // Filter out models that do not support verbosity
  if (!isGPT5FamilyModel(model)) return [undefined]

  // chat variant: only medium
  if (id.includes('chat')) return [undefined, null, 'medium']

  // codex variant: old codex only medium, newer codex all levels
  if (id.includes('codex')) {
    if (isGPT5SeriesModel(model) || isGPT51SeriesModel(model) || isGPT52SeriesModel(model)) {
      return [undefined, null, 'medium']
    }
    return [undefined, null, 'low', 'medium', 'high']
  }

  // pro: all levels
  if (id.includes('pro')) return [undefined, null, 'low', 'medium', 'high']

  // default for GPT-5 family
  return [undefined, null, 'low', 'medium', 'high']
}

// ═════════════════════════════════════════════��══════════════════════════════
// Section 2 — Model-ID Inference Helpers (string matching)
//
// Used by modelMerger at model-creation time to populate schema fields when
// preset metadata is unavailable. NOT intended for runtime queries.
// ═══��═════════════════════════════════════════════════════���══════════════════

// ---------------------------------------------------------------------------
// Name extraction utilities
// ---------------------------------------------------------------------------

/**
 * Extract the base model name from a model ID.
 * e.g. 'deepseek/deepseek-r1' => 'deepseek-r1'
 */
export const getBaseModelName = (id: string, delimiter: string = '/'): string => {
  const parts = id.split(delimiter)
  return parts[parts.length - 1]
}

/**
 * Extract the base model name and normalize to lowercase.
 * Handles Fireworks version-number normalization and common suffixes.
 */
export const getLowerBaseModelName = (id: string, delimiter: string = '/'): string => {
  const normalizedId = id.toLowerCase().startsWith('accounts/fireworks/models/')
    ? id.replace(/(\d)p(?=\d)/g, '$1.')
    : id

  let baseModelName = getBaseModelName(normalizedId, delimiter).toLowerCase()
  if (baseModelName.endsWith(':free')) baseModelName = baseModelName.replace(':free', '')
  if (baseModelName.endsWith('(free)')) baseModelName = baseModelName.replace('(free)', '')
  if (baseModelName.endsWith(':cloud')) baseModelName = baseModelName.replace(':cloud', '')
  return baseModelName
}

// ---------------------------------------------------------------------------
// Regex constants (used by inference helpers)
// ---------------------------------------------------------------------------

export const REASONING_REGEX =
  /^(?!.*-non-reasoning\b)(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking|think)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-(?:3-mini|4|4-fast)(?:-[\w-]+)?\b.*)$/i

export const GEMINI_FLASH_MODEL_REGEX = /gemini.*flash/i

export const GEMINI_THINKING_MODEL_REGEX =
  /gemini-(?:2\.5.*(?:-latest)?|3(?:\.\d+)?-(?:flash|pro)(?:-preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\w-]+)*$/i

export const DOUBAO_THINKING_MODEL_REGEX =
  /doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-(?:thinking)(?:-|$))|seed-code(?:-preview)?(?:-\d+)?|seed-2[.-]0(?:-[\w-]+)?)(?:-[\w-]+)*/i

export const DOUBAO_THINKING_AUTO_MODEL_REGEX =
  /doubao-(1-5-thinking-pro-m|seed-1[.-]6)(?!-(?:flash|thinking)(?:-|$))(?:-lite)?(?!-251015)(?:-\d+)?$/i

// ---------------------------------------------------------------------------
// Inference functions — populate model schema from raw ID
// ---------------------------------------------------------------------------

/** Infer whether a raw model ID represents a reasoning model */
export function inferReasoningFromModelId(rawModelId: string): boolean {
  const id = getLowerBaseModelName(rawModelId)
  return (
    REASONING_REGEX.test(id) ||
    inferClaudeReasoningFromId(id) ||
    inferGeminiReasoningFromId(id) ||
    inferQwenReasoningFromId(id) ||
    inferDoubaoReasoningFromId(id) ||
    id.includes('hunyuan-t1') ||
    id.includes('hunyuan-a13b') ||
    /glm-?5|glm-4\.[567]|glm-z1/.test(id) ||
    ['mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni'].some((m) => id.includes(m)) ||
    /^kimi-k2-thinking(?:-turbo)?$|^kimi-k2\.5(?:-\w)*$/.test(id) ||
    id.includes('magistral') ||
    id.includes('pangu-pro-moe') ||
    id.includes('seed-oss') ||
    id.includes('deepseek-v3.2-speciale') ||
    id.includes('gemma-4') ||
    id.includes('gemma4') ||
    id.includes('step-3') ||
    id.includes('step-r1-v-mini') ||
    ['minimax-m1', 'minimax-m2', 'minimax-m2.1'].some((m) => id.includes(m)) ||
    id === 'baichuan-m2' ||
    id === 'baichuan-m3' ||
    ['ring-1t', 'ring-mini', 'ring-flash'].some((m) => id.includes(m)) ||
    inferDeepSeekHybridFromId(id)
  )
}

/** Infer whether a raw model ID represents a vision model */
export function inferVisionFromModelId(rawModelId: string): boolean {
  const id = getLowerBaseModelName(rawModelId)
  return VISION_REGEX.test(id) || IMAGE_ENHANCEMENT_REGEX.test(id)
}

/** Infer whether a raw model ID represents an embedding model */
export function inferEmbeddingFromModelId(rawModelId: string): boolean {
  const id = getLowerBaseModelName(rawModelId)
  if (RERANKING_REGEX.test(id)) return false
  return EMBEDDING_REGEX.test(id)
}

/** Infer whether a raw model ID represents a reranking model */
export function inferRerankFromModelId(rawModelId: string): boolean {
  return RERANKING_REGEX.test(getLowerBaseModelName(rawModelId))
}

/** Infer whether a raw model ID represents a dedicated image generation model */
export function inferImageGenerationFromModelId(rawModelId: string): boolean {
  return DEDICATED_IMAGE_MODEL_REGEX.test(getLowerBaseModelName(rawModelId))
}

/** Infer whether a raw model ID represents a web search capable model */
export function inferWebSearchFromModelId(rawModelId: string): boolean {
  const id = getLowerBaseModelName(rawModelId, '/')
  if (CLAUDE_WEBSEARCH_REGEX.test(id)) return true
  if (inferOpenAIWebSearchFromId(id)) return true
  if (GEMINI_SEARCH_REGEX.test(id)) return true
  return false
}

// ---------------------------------------------------------------------------
// Token limit inference
// ---------------------------------------------------------------------------

const THINKING_TOKEN_MAP: Record<string, { min: number; max: number }> = {
  'gemini-2\\.5-flash-lite.*$': { min: 512, max: 24576 },
  'gemini-.*-flash.*$': { min: 0, max: 24576 },
  'gemini-.*-pro.*$': { min: 128, max: 32768 },
  'qwen3-235b-a22b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen3-30b-a3b-thinking-2507$': { min: 0, max: 81_920 },
  'qwen3-vl-235b-a22b-thinking$': { min: 0, max: 81_920 },
  'qwen3-vl-30b-a3b-thinking$': { min: 0, max: 81_920 },
  'qwen-plus-2025-07-14$': { min: 0, max: 38_912 },
  'qwen-plus-2025-04-28$': { min: 0, max: 38_912 },
  'qwen3-1\\.7b$': { min: 0, max: 30_720 },
  'qwen3-0\\.6b$': { min: 0, max: 30_720 },
  'qwen-plus.*$': { min: 0, max: 81_920 },
  'qwen-turbo.*$': { min: 0, max: 38_912 },
  'qwen-flash.*$': { min: 0, max: 81_920 },
  'qwen3-max(-.*)?$': { min: 0, max: 81_920 },
  '^qwen3\\.[5-9]': { min: 0, max: 81_920 },
  'qwen3-(?!max).*$': { min: 1024, max: 38_912 },
  '(?:anthropic\\.)?claude-opus-4[.-]6(?:[@\\-:][\\w\\-:]+)?$': { min: 1024, max: 128_000 },
  '(?:anthropic\\.)?claude-(:?sonnet|haiku)-4[.-]6.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 64_000 },
  '(?:anthropic\\.)?claude-(:?haiku|sonnet|opus)-4[.-]5.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 64_000 },
  '(?:anthropic\\.)?claude-opus-4[.-]1.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 32_000 },
  '(?:anthropic\\.)?claude-sonnet-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$': {
    min: 1024,
    max: 64_000
  },
  '(?:anthropic\\.)?claude-opus-4(?:[.-]0)?(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$': {
    min: 1024,
    max: 32_000
  },
  '(?:anthropic\\.)?claude-3[.-]7.*sonnet.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 64_000 },
  'baichuan-m2$': { min: 0, max: 30_000 },
  'baichuan-m3$': { min: 0, max: 30_000 },
  'gemma-?4[:-]?e[24]b': { min: 1024, max: 8192 },
  'gemma-?4[:-]?26b': { min: 1024, max: 30720 },
  'gemma-?4[:-]?31b': { min: 1024, max: 30720 }
}

/** Find thinking token limits for a raw model ID (used during model creation) */
export const findTokenLimit = (rawModelId: string): { min: number; max: number } | undefined => {
  for (const [pattern, limits] of Object.entries(THINKING_TOKEN_MAP)) {
    if (new RegExp(pattern, 'i').test(rawModelId)) {
      return limits
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Internal inference sub-functions
// ---------------------------------------------------------------------------

function inferClaudeReasoningFromId(id: string): boolean {
  return (
    id.includes('claude-3-7-sonnet') ||
    id.includes('claude-3.7-sonnet') ||
    id.includes('claude-sonnet-4') ||
    id.includes('claude-opus-4') ||
    id.includes('claude-haiku-4')
  )
}

function inferGeminiReasoningFromId(id: string): boolean {
  if (id.startsWith('gemini') && id.includes('thinking')) return true
  if (GEMINI_THINKING_MODEL_REGEX.test(id)) {
    if (id.includes('gemini-3-pro-image')) return true
    if (id.includes('image') || id.includes('tts')) return false
    return true
  }
  return false
}

function inferQwenReasoningFromId(id: string): boolean {
  if (id.startsWith('qwen3') && id.includes('thinking')) return true
  if (id.includes('qwq') || id.includes('qvq')) return true
  // Check thinking token support
  if (['coder', 'asr', 'tts', 'reranker', 'embedding', 'instruct', 'thinking'].some((f) => id.includes(f))) {
    return false
  }
  if (/^qwen3\.[5-9]/.test(id)) return true
  if (/^(?:qwen3-max(?!-2025-09-23)|qwen-max-latest)(?:-|$)/i.test(id)) return true
  if (/^qwen(?:3\.[5-9])?-(?:plus|flash|turbo)(?:-|$)/i.test(id)) return true
  if (/^qwen3-\d/i.test(id)) return true
  return false
}

function inferDoubaoReasoningFromId(id: string): boolean {
  return DOUBAO_THINKING_MODEL_REGEX.test(id) || REASONING_REGEX.test(id)
}

function inferDeepSeekHybridFromId(id: string): boolean {
  return (
    /(\w+-)?deepseek-v3(?:\.\d|-\d)(?:(\.|-)(?!speciale$)\w+)?$/.test(id) ||
    id.includes('deepseek-chat-v3.1') ||
    id.includes('deepseek-chat')
  )
}

function inferOpenAIWebSearchFromId(id: string): boolean {
  return (
    id.includes('gpt-4o-search-preview') ||
    id.includes('gpt-4o-mini-search-preview') ||
    (id.includes('gpt-4.1') && !id.includes('gpt-4.1-nano')) ||
    (id.includes('gpt-4o') && !id.includes('gpt-4o-image')) ||
    id.includes('o3') ||
    id.includes('o4') ||
    (id.includes('gpt-5') && !id.includes('chat'))
  )
}

// ---------------------------------------------------------------------------
// Internal regex constants for inference
// ---------------------------------------------------------------------------

const EMBEDDING_REGEX = /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i

const DEDICATED_IMAGE_MODELS = [
  'dall-e(?:-[\\w-]+)?',
  'gpt-image(?:-[\\w-]+)?',
  'grok-2-image(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'flux(?:-[\\w-]+)?',
  'stable-?diffusion(?:-[\\w-]+)?',
  'stabilityai(?:-[\\w-]+)?',
  'sd-[\\w-]+',
  'sdxl(?:-[\\w-]+)?',
  'cogview(?:-[\\w-]+)?',
  'qwen-image(?:-[\\w-]+)?',
  'janus(?:-[\\w-]+)?',
  'midjourney(?:-[\\w-]+)?',
  'mj-[\\w-]+',
  'z-image(?:-[\\w-]+)?',
  'longcat-image(?:-[\\w-]+)?',
  'hunyuanimage(?:-[\\w-]+)?',
  'seedream(?:-[\\w-]+)?',
  'kandinsky(?:-[\\w-]+)?'
]

const DEDICATED_IMAGE_MODEL_REGEX = new RegExp(DEDICATED_IMAGE_MODELS.join('|'), 'i')

const IMAGE_ENHANCEMENT_MODELS = [
  'grok-2-image(?:-[\\w-]+)?',
  'qwen-image-edit',
  'gpt-image-1',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?'
]

const IMAGE_ENHANCEMENT_REGEX = new RegExp(IMAGE_ENHANCEMENT_MODELS.join('|'), 'i')

const visionAllowedModels = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-3(?:\\.\\d)?-(?:flash|pro)(?:-preview)?',
  'gemini-(flash|pro|flash-lite)-latest',
  'gemini-exp',
  'claude-3',
  'claude-haiku-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3\\.[5-9](?:-[\\w-]+)?',
  'qwen2.5-omni',
  'qwen3-omni(?:-[\\w-]+)?',
  'qvq',
  'internvl2',
  'grok-vision-beta',
  'grok-4(?:-[\\w-]+)?',
  'pixtral',
  'gpt-4(?:-[\\w-]+)',
  'gpt-4.1(?:-[\\w-]+)?',
  'gpt-4o(?:-[\\w-]+)?',
  'gpt-4.5(?:-[\\w-]+)',
  'gpt-5(?:-[\\w-]+)?',
  'chatgpt-4o(?:-[\\w-]+)?',
  'o1(?:-[\\w-]+)?',
  'o3(?:-[\\w-]+)?',
  'o4(?:-[\\w-]+)?',
  'deepseek-vl(?:[\\w-]+)?',
  'kimi-k2.5',
  'kimi-latest',
  'gemma-?[3-4](?:[-.\\w]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-2[.-]0(?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  'gemma3(?:[-:\\w]+)?',
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?',
  'qwen-omni(?:-[\\w-]+)?',
  'mistral-large-(2512|latest)',
  'mistral-medium-(2508|latest)',
  'mistral-small-(2506|latest)',
  'mimo-v2-omni(?:-[\\w-]+)?',
  'glm-5v-turbo'
]

const visionExcludedModels = [
  'gpt-4-\\d+-preview',
  'gpt-4-turbo-preview',
  'gpt-4-32k',
  'gpt-4-\\d+',
  'o1-mini',
  'o3-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1'
]

const VISION_REGEX = new RegExp(
  `\\b(?!(?:${visionExcludedModels.join('|')})\\b)(${visionAllowedModels.join('|')})\\b`,
  'i'
)

const CLAUDE_WEBSEARCH_REGEX = new RegExp(
  `\\b(?:claude-3(-|\\.)(7|5)-sonnet(?:-[\\w-]+)|claude-3(-|\\.)5-haiku(?:-[\\w-]+)|claude-(haiku|sonnet|opus)-4(?:-[\\w-]+)?)\\b`,
  'i'
)

const GEMINI_SEARCH_REGEX = new RegExp(
  'gemini-(?:2(?!.*-image-preview).*(?:-latest)?|3(?:\\.\\d+)?-(?:flash|pro)(?:-(?:image-)?preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\\w-]+)*$',
  'i'
)

// ---------------------------------------------------------------------------
// Internal helper: extract raw model ID from Model
// ---------------------------------------------------------------------------

function getRawModelId(model: Model): string {
  const id = model.id as string
  if (id.includes(UNIQUE_MODEL_ID_SEPARATOR)) {
    return parseUniqueModelId(id as UniqueModelId).modelId
  }
  return id
}
