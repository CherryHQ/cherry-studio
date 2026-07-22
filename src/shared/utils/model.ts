/**
 * Model identification and capability check functions.
 *
 * This module has two sections:
 *
 * 1. **Runtime model checks** — query Model schema fields (capabilities, reasoning,
 *    parameterSupport). These are the primary API for callers.
 *
 * 2. **Model-ID utilities** — name normalization (`getLowerBaseModelName`).
 *    Capability inference from raw ids lives in
 *    `@cherrystudio/provider-registry` (creator-declared data).
 */

import { MODALITY, VENDOR_PATTERNS } from '@cherrystudio/provider-registry'
import { CHERRYAI_PROVIDER_ID, isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import { MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'

/** Check if model has reasoning capability */
export const isReasoningModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.REASONING) || model.reasoning != null

/** Check if model supports vision/image input */
export const isVisionModel = (model: Model): boolean =>
  !!(model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION) || model.inputModalities?.includes(MODALITY.IMAGE))

export const isVideoModel = (model: Model): boolean =>
  !!(model.capabilities.includes(MODEL_CAPABILITY.VIDEO_RECOGNITION) || model.inputModalities?.includes(MODALITY.VIDEO))

export const isAudioModel = (model: Model): boolean =>
  !!(model.capabilities.includes(MODEL_CAPABILITY.AUDIO_RECOGNITION) || model.inputModalities?.includes(MODALITY.AUDIO))

/** Check if model is an embedding model */
export const isEmbeddingModel = (model: Model): boolean => model.capabilities.includes(MODEL_CAPABILITY.EMBEDDING)

/** Check if model is a reranking model */
export const isRerankModel = (model: { capabilities?: readonly unknown[] | null }): boolean =>
  model.capabilities?.includes(MODEL_CAPABILITY.RERANK) ?? false

/** Check if model supports function calling / tool use */
export const isFunctionCallingModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL)

/** Check if model supports web search */
export const isWebSearchModel = (model: Model): boolean => model.capabilities.includes(MODEL_CAPABILITY.WEB_SEARCH)

/** Check if model supports image generation */
export const isGenerateImageModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)

export const isFreeModel = (model: Pick<Model, 'id' | 'name' | 'providerId'>): boolean => {
  if (model.providerId === CHERRYAI_PROVIDER_ID) {
    return true
  }

  return (model.id + model.name).toLowerCase().includes('free')
}

export const isGenerateVideoModel = (model: Model): boolean =>
  !!model.capabilities.includes(MODEL_CAPABILITY.VIDEO_GENERATION)

export const isGenerateAudioModel = (model: Model): boolean =>
  !!model.capabilities.includes(MODEL_CAPABILITY.AUDIO_GENERATION)

export const isEditImageModel = (model: Model): boolean =>
  !!(model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION) && model.inputModalities?.includes(MODALITY.IMAGE))

// A dedicated speech-to-text model is identified by the explicit AUDIO_TRANSCRIPT
// capability only. Accepting audio as an *input modality* does NOT make a model
// speech-to-text — multimodal chat LLMs (Gemini, GPT-4o, …) take audio input yet are
// still general chat models, and keying on the modality wrongly classified them as
// non-chat (via `isNonChatModel`) and hid them from every model picker.
export const isSpeechToTextModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.AUDIO_TRANSCRIPT)

// Mirror of `isSpeechToTextModel`: a dedicated text-to-speech model is identified by
// the explicit AUDIO_GENERATION capability only. Producing audio as an *output
// modality* does NOT make a model text-to-speech — multimodal chat LLMs can emit audio
// yet still chat, and keying on the modality wrongly classified them as non-chat.
export const isTextToSpeechModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.AUDIO_GENERATION)

/** Check if model is a dedicated text-to-image model (no text chat) */
export const isTextToImageModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION) &&
  !model.capabilities.includes(MODEL_CAPABILITY.REASONING)

export const isNonChatModel = (model: Model): boolean =>
  isEmbeddingModel(model) ||
  isRerankModel(model) ||
  isGenerateImageModel(model) ||
  isGenerateVideoModel(model) ||
  isGenerateAudioModel(model) ||
  isTextToSpeechModel(model) ||
  isSpeechToTextModel(model)

/**
 * Models the API gateway can route — the single predicate shared by the gateway's
 * `/v1/models` listing and the renderer's gateway model picker, so the CLI can only
 * pick what the gateway will actually serve. Excludes non-chat models (the gateway
 * only proxies chat dialects), the CherryAI managed default (the gateway's own
 * guard), and models of a provider whose id contains ':' — the gateway address
 * ("providerId:apiModelId") splits on the FIRST ':', so such ids cannot round-trip.
 */
export const isGatewayRoutableModel = (model: Model): boolean => {
  if (model.providerId.includes(':') || isNonChatModel(model)) return false
  return !isManagedCherryAiDefaultModel(model.providerId, getRawModelId(model))
}

// ---------------------------------------------------------------------------
// Reasoning configuration
// ---------------------------------------------------------------------------

/** Check if model supports thinking token control */
export const isSupportedThinkingTokenModel = (model: Model): boolean => model.reasoning?.thinkingTokenLimits != null

/** Check if model supports reasoning effort configuration */
export const isSupportedReasoningEffortModel = (model: Model): boolean =>
  (model.reasoning?.selectableEfforts?.length ?? 0) > 0

/**
 * A fixed reasoning model: it reasons, but offers no tuning knobs.
 * No thinking-token limits and no supported efforts.
 */
export const isFixedReasoningModel = (model: Model): boolean =>
  isReasoningModel(model) && !isSupportedThinkingTokenModel(model) && !isSupportedReasoningEffortModel(model)

/** Get the reasoning effort options the UI should expose for this model */
export const getModelSupportedReasoningEffortOptions = (model: Model | undefined | null): string[] | undefined => {
  if (!model) return undefined
  return model.reasoning?.selectableEfforts
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

// Vendor identity checks all delegate to `VENDOR_PATTERNS` in
// `@cherrystudio/provider-registry`. Do NOT inline new regex here —
// add the vendor to the registry's pattern map instead of duplicating
// regexes in renderer code.

/** Check if model is an Anthropic/Claude model */
export const isAnthropicModel = (model: Model): boolean =>
  VENDOR_PATTERNS.anthropic.test(getLowerBaseModelName(getRawModelId(model)))

/** Check if model is a Gemini model */
export const isGeminiModel = (model: Model): boolean =>
  VENDOR_PATTERNS.gemini.test(getLowerBaseModelName(getRawModelId(model)))

/** Check if model is Gemini 3 series (sub-family of Gemini, ID-specific). */
export const isGemini3Model = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return id.includes('gemini-3') || id === 'gemini-flash-latest' || id === 'gemini-pro-latest'
}

/** Check if model is a Grok model */
export const isGrokModel = (model: Model): boolean =>
  VENDOR_PATTERNS.grok.test(getLowerBaseModelName(getRawModelId(model)))

/** Check if model is an OpenAI model (GPT or o-series) */
export const isOpenAIModel = (model: Model): boolean =>
  VENDOR_PATTERNS.openai.test(getLowerBaseModelName(getRawModelId(model)))

/** Check if model is an OpenAI LLM model (excludes image-generation GPT-4o variants) */
export const isOpenAILLMModel = (model: Model): boolean => {
  if (!isOpenAIModel(model)) return false
  return !getLowerBaseModelName(getRawModelId(model)).includes('gpt-4o-image')
}

/** Check if model is a Qwen family model (all variants, including qwq/qvq). */
export const isQwenModel = (model: Model): boolean =>
  VENDOR_PATTERNS.qwen.test(getLowerBaseModelName(getRawModelId(model), '/'))

/** Check if model is a DeepSeek model. */
export const isDeepSeekModel = (model?: Model): boolean => {
  if (!model) return false
  if (VENDOR_PATTERNS.deepseek.test(getLowerBaseModelName(getRawModelId(model), '/'))) return true
  if (model.providerId === 'deepseek') return true
  return model.name ? VENDOR_PATTERNS.deepseek.test(model.name.toLowerCase()) : false
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

/** GPT-5 family models support verbosity */
export const isSupportVerbosityModel = isGPT5FamilyModel

/** Check if model supports flex service tier */
export const isSupportFlexServiceTierModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return (id.includes('o3') && !id.includes('o3-mini')) || id.includes('o4-mini') || id.includes('gpt-5')
}

export const isSupportedFlexServiceTier = isSupportFlexServiceTierModel

/**
 * Claude reasoning model = Anthropic vendor + REASONING capability. The
 * registry populates REASONING via the registry membership heuristics
 * (3.7-sonnet, 4-series), so the capability is the right source of truth.
 */
export const isClaudeReasoningModel = (model: Model): boolean => isAnthropicModel(model) && isReasoningModel(model)

/**
 * Thinking-token support for Claude = Anthropic vendor + `thinkingTokenLimits`
 * populated. `THINKING_TOKEN_MAP` covers the same 3.7 / 4-series SKUs that
 * qualify as reasoning, so the two checks coincide — but deriving each from
 * its own capability field keeps the semantics clear.
 */
export const isSupportedThinkingTokenClaudeModel = (model: Model): boolean =>
  isAnthropicModel(model) && isSupportedThinkingTokenModel(model)

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

/** Check if model is Claude Opus 4.7. Rejects temperature/top_p/top_k and natively supports xhigh reasoning effort. */
export const isClaude47SeriesModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return /(?:anthropic\.)?claude-opus-4[.-]7(?:[@\-:][\w\-:]+)?$/i.test(id)
}

/** Check if model is Claude 4.5 reasoning */
export const isClaude45ReasoningModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return /claude-(sonnet|opus|haiku)-4(-|.)5(?:-[\w-]+)?$/i.test(id)
}

/** Check if model is Qwen MT (machine translation) */
export const isQwenMTModel = (model: Model): boolean => getLowerBaseModelName(getRawModelId(model)).includes('qwen-mt')

/** Check if model is Qwen 3.5-3.9 series */
export const isQwen35to39Model = (model: Model): boolean =>
  /^qwen3\.[5-9]/.test(getLowerBaseModelName(getRawModelId(model), '/'))

/**
 * Qwen thinking-token knob support. Semantically distinct from
 * generic reasoning support: some Qwen SKUs (`qwen3-*-thinking`,
 * `qwen3-vl-*-thinking`) ship with "always-on" thinking that has no
 * user-controllable knob. This check returns `true` only for SKUs where the
 * thinking-token toggle is meaningful.
 *
 * Kept as ID inference because "always-on" vs "controllable" is a per-SKU
 * behaviour hint the registry does not currently encode as a capability flag.
 */
export const isSupportedThinkingTokenQwenModel = (model: Model): boolean => {
  if (!isQwenModel(model)) return false
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  if (['coder', 'asr', 'tts', 'reranker', 'embedding', 'instruct', 'thinking'].some((f) => id.includes(f))) {
    return false
  }
  return isSupportedThinkingTokenModel(model)
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

// ═════════════════════════════════════════════════════════════════════════════
// Section 2 — Model-ID Utilities (name normalization + legacy delegates)
// ═════════════════════════════════════════════════════════════════════════════

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

export const groupQwenModels = <T extends Pick<Model, 'id'> & Partial<Pick<Model, 'group'>>>(
  models: T[]
): Record<string, T[]> => {
  return models.reduce<Record<string, T[]>>((groups, model) => {
    const modelId = getLowerBaseModelName(model.id)
    const prefixMatch = modelId.match(/^(qwen(?:\d+\.\d+|2(?:\.\d+)?|-\d+b|-(?:max|coder|vl)))/i)
    const groupKey = prefixMatch ? prefixMatch[1] : model.group || '其他'

    if (!groups[groupKey]) {
      groups[groupKey] = []
    }
    groups[groupKey].push(model)
    return groups
  }, {})
}

export const GEMINI_FLASH_MODEL_REGEX = /gemini.*flash/i

// ---------------------------------------------------------------------------
// Internal helper: extract raw model ID from Model
// ---------------------------------------------------------------------------

function getRawModelId(model: Model): string {
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

// ---------------------------------------------------------------------------
// Family reasoning checks
// ---------------------------------------------------------------------------

/**
 * GPT-5 series reasoning variants are identified by series membership plus
 * the REASONING capability — the `chat` SKU is carved out of the series
 * check by `isGPT5SeriesModel` already, so no extra ID filter is needed.
 */
export const isGPT5SeriesReasoningModel = (model: Model): boolean => isGPT5SeriesModel(model) && isReasoningModel(model)

// ---------------------------------------------------------------------------
// Web search variants
// ---------------------------------------------------------------------------

/**
 * OpenAI model with native web-search capability.
 *
 * Composition: `isOpenAIModel(model) && isWebSearchModel(model)`. The
 * vendor gate keeps the check from matching Gemini / Claude searches;
 * `isWebSearchModel` reads the `WEB_SEARCH` capability the registry /
 * bridge populates (which encodes the specific SKU exclusions such as
 * `gpt-4o-image`, `gpt-4.1-nano`, `gpt-5-chat`).
 */
export const isOpenAIWebSearchModel = (model: Model): boolean => isOpenAIModel(model) && isWebSearchModel(model)
