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

import { MODALITY, VENDOR_PATTERNS } from '@cherrystudio/provider-registry'
import type { Model, RuntimeReasoning, ThinkingTokenLimits } from '@shared/data/types/model'
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
  if (model.providerId === 'cherryai') {
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

export const isSpeechToTextModel = (model: Model): boolean =>
  !!(model.capabilities.includes(MODEL_CAPABILITY.AUDIO_TRANSCRIPT) || model.inputModalities?.includes(MODALITY.AUDIO))

export const isTextToSpeechModel = (model: Model): boolean =>
  !!(model.capabilities.includes(MODEL_CAPABILITY.AUDIO_GENERATION) || model.outputModalities?.includes(MODALITY.AUDIO))

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

// Vendor identity checks all delegate to `VENDOR_PATTERNS` in
// `@cherrystudio/provider-registry`. Do NOT inline new regex here —
// add the vendor to the registry's pattern map instead so icon routing
// and capability inference stay aligned.

/** Check if model is an Anthropic/Claude model */
export const isAnthropicModel = (model: Model): boolean =>
  VENDOR_PATTERNS.anthropic.test(getLowerBaseModelName(getRawModelId(model)))

/** Check if model is a Gemini model */
export const isGeminiModel = (model: Model): boolean =>
  VENDOR_PATTERNS.gemini.test(getLowerBaseModelName(getRawModelId(model))) || model.providerId === 'gemini'

/** Check if model is Gemini 3 series (sub-family of Gemini, ID-specific). */
export const isGemini3Model = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gemini-3')

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

const vendorCheck =
  (pattern: RegExp) =>
  (model: Model): boolean =>
    pattern.test(getLowerBaseModelName(getRawModelId(model), '/'))

/** Check if model is a Qwen family model (all variants, including qwq/qvq). */
export const isQwenModel = vendorCheck(VENDOR_PATTERNS.qwen)

/** Check if model is a Doubao (ByteDance) model. */
export const isDoubaoModel = (model: Model): boolean =>
  VENDOR_PATTERNS.doubao.test(getLowerBaseModelName(getRawModelId(model), '/')) || model.providerId === 'doubao'

/** Check if model is a Hunyuan (Tencent) model. */
export const isHunyuanModel = (model: Model): boolean =>
  VENDOR_PATTERNS.hunyuan.test(getLowerBaseModelName(getRawModelId(model), '/')) || model.providerId === 'hunyuan'

/** Check if model is a Kimi / Moonshot model. */
export const isKimiModel = (model: Model): boolean =>
  VENDOR_PATTERNS.kimi.test(getLowerBaseModelName(getRawModelId(model), '/')) || model.providerId === 'moonshot'

/** Check if model is a DeepSeek model. */
export const isDeepSeekModel = (model?: Model): boolean => {
  if (!model) return false
  if (VENDOR_PATTERNS.deepseek.test(getLowerBaseModelName(getRawModelId(model), '/'))) return true
  if (model.providerId === 'deepseek') return true
  return model.name ? VENDOR_PATTERNS.deepseek.test(model.name.toLowerCase()) : false
}

/** Check if model is a Perplexity (sonar family) model. */
export const isPerplexityModel = (model: Model): boolean =>
  VENDOR_PATTERNS.perplexity.test(getLowerBaseModelName(getRawModelId(model), '/')) || model.providerId === 'perplexity'

/** Check if model is a Baichuan model. */
export const isBaichuanModel = vendorCheck(VENDOR_PATTERNS.baichuan)

/** Check if model is a MiMo (Xiaomi) model. */
export const isMiMoModel = vendorCheck(VENDOR_PATTERNS.mimo)

/** Check if model is a Ling / Ring (Ant Group) model. */
export const isLingModel = vendorCheck(VENDOR_PATTERNS.ling)

/** Check if model is a MiniMax model. */
export const isMiniMaxModel = vendorCheck(VENDOR_PATTERNS.minimax)

/** Check if model is a Step (StepFun) model. */
export const isStepModel = vendorCheck(VENDOR_PATTERNS.step)

export const isMistralModel = vendorCheck(VENDOR_PATTERNS.mistral)

/**
 * OpenAI reasoning model = OpenAI vendor + REASONING capability.
 * The registry populates REASONING via `inferOpenAIReasoningFromId`
 * (o-series, GPT-5 non-chat, gpt-oss), so the capability is the right
 * source of truth here — no need to re-check IDs at runtime.
 */
export const isOpenAIReasoningModel = (model: Model): boolean => isOpenAIModel(model) && isReasoningModel(model)

/** Check if model only supports chat completion (no responses API) */
export const isOpenAIChatCompletionOnlyModel = (m: Model) => {
  const id = getLowerBaseModelName(getRawModelId(m))
  return isOpenAIWebSearchChatCompletionOnlyModel(m) || id.includes('o1-mini') || id.includes('o1-preview')
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

/**
 * OpenAI reasoning-effort support = OpenAI vendor + supportedEfforts populated.
 * The bridge populates `supportedEfforts` for o-series / GPT-5 non-chat /
 * gpt-oss via `inferSupportedEfforts`, matching the legacy regex exactly.
 */
export const isSupportedReasoningEffortOpenAIModel = (model: Model): boolean =>
  isOpenAIModel(model) && isSupportedReasoningEffortModel(model)

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

/**
 * Claude reasoning model = Anthropic vendor + REASONING capability. The
 * registry populates REASONING via `inferClaudeReasoningFromId` (3.7-sonnet,
 * 4-series), so the capability is the right source of truth.
 */
export const isClaudeReasoningModel = (model: Model): boolean => isAnthropicModel(model) && isReasoningModel(model)

export const isMistralReasoningModel = (model: Model): boolean => isMistralModel(model) && isReasoningModel(model)
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

/** Check if model is a Gemma 4 model hosted on Gemini API (supports thinking mode but no hard-off). */
export const isHostedGemma4ThinkingModel = (model: Model): boolean => {
  if (model.providerId !== 'gemini') return false
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return id.startsWith('gemma-4-')
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

/**
 * Gemini thinking-token support = Gemini vendor + `thinkingTokenLimits`.
 * `THINKING_TOKEN_MAP` covers the 2.5/3.x flash / pro / flash-lite families
 * (including the `*-latest` aliases) that `inferGeminiReasoningFromId`
 * recognises, so the capability is populated on exactly the same SKUs the
 * legacy regex used to gate on.
 */
export const isSupportedThinkingTokenGeminiModel = (model: Model): boolean =>
  isGeminiModel(model) && isSupportedThinkingTokenModel(model)

/**
 * Grok reasoning-effort support = Grok vendor + supportedEfforts populated.
 * Bridge-populated via `inferSupportedEfforts` for `grok-3-mini`. The
 * OpenRouter-specific `grok-4-fast` path is preserved here as an ID-based
 * branch because it depends on `providerId`, not a capability — OpenRouter
 * exposes an `-effort` knob on that SKU that the native xAI route doesn't.
 */
export const isSupportedReasoningEffortGrokModel = (model: Model): boolean => {
  if (isGrokModel(model) && isSupportedReasoningEffortModel(model)) return true
  if (model.providerId === 'openrouter') {
    return getLowerBaseModelName(getRawModelId(model)).includes('grok-4-fast')
  }
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

/**
 * Qwen reasoning model = Qwen vendor + REASONING capability. The registry
 * populates REASONING via `inferQwenReasoningFromId` (QwQ / QVQ / qwen3*
 * thinking / qwen3-max / qwen-plus / etc.), so the capability is the right
 * source of truth.
 */
export const isQwenReasoningModel = (model: Model): boolean => isQwenModel(model) && isReasoningModel(model)

/**
 * Qwen thinking-token knob support. Semantically distinct from
 * `isQwenReasoningModel`: some Qwen SKUs (`qwen3-*-thinking`, `qwen3-vl-*-thinking`)
 * ship with "always-on" thinking that has no user-controllable knob — they
 * reason but the UI should not expose the slider. This check returns `true`
 * only for SKUs where the thinking-token toggle is meaningful.
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

/**
 * Qwen variants that ship "always on" thinking with no disable toggle.
 * Kept as ID inference because this is a per-SKU behaviour hint that the
 * registry does not currently model separately from the thinking-token
 * capability itself.
 */
export const isQwenAlwaysThinkModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return (id.startsWith('qwen3') && id.includes('thinking')) || (id.includes('qwen3-vl') && id.includes('thinking'))
}

/** Check if Doubao model supports thinking auto mode (specific SKU subset). */
export const isDoubaoThinkingAutoModel = (model: Model): boolean =>
  DOUBAO_THINKING_AUTO_MODEL_REGEX.test(getLowerBaseModelName(getRawModelId(model)))

/** Doubao seed variant released after 251015 (version-specific regex). */
export const isDoubaoSeedAfter251015 = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return /doubao-seed-1-6-(?:lite-)?251015|doubao-seed-2[.-]0/i.test(id)
}

/** Doubao seed 1.8 variant (version-specific regex). */
export const isDoubaoSeed18Model = (model: Model): boolean =>
  /doubao-seed-1[.-]8(?:-[\w-]+)?/i.test(getLowerBaseModelName(getRawModelId(model)))

/**
 * Doubao thinking-token support = Doubao vendor + `thinkingTokenLimits`.
 * THINKING_TOKEN_MAP mirrors DOUBAO_THINKING_MODEL_REGEX for SKU coverage.
 */
export const isSupportedThinkingTokenDoubaoModel = (model: Model): boolean =>
  isDoubaoModel(model) && isSupportedThinkingTokenModel(model)

/**
 * Hunyuan thinking-token support = Hunyuan vendor + `thinkingTokenLimits`.
 * Only `hunyuan-a13b` currently ships the knob.
 */
export const isSupportedThinkingTokenHunyuanModel = (model: Model): boolean =>
  isHunyuanModel(model) && isSupportedThinkingTokenModel(model)

/**
 * Zhipu / GLM thinking-token support = Zhipu vendor + `thinkingTokenLimits`.
 * Covers GLM-5 and GLM-4.5 / 4.6 / 4.7 via THINKING_TOKEN_MAP.
 */
export const isSupportedThinkingTokenZhipuModel = (model: Model): boolean =>
  isZhipuModel(model) && isSupportedThinkingTokenModel(model)

/**
 * MiMo thinking-token support = MiMo vendor + `thinkingTokenLimits`.
 * Covers `mimo-v2.5` and `mimo-v2-flash / pro / omni` via THINKING_TOKEN_MAP.
 */
export const isSupportedThinkingTokenMiMoModel = (model: Model): boolean =>
  isMiMoModel(model) &&
  isSupportedThinkingTokenModel(model) &&
  !/(?:^|-)tts(?:-|$)|(?:^|-)asr(?:-|$)/i.test(getLowerBaseModelName(getRawModelId(model)))

/**
 * Kimi thinking-token support = Kimi vendor + `thinkingTokenLimits`.
 * Kimi K2.5 and newer currently ship the knob.
 */
export const isSupportedThinkingTokenKimiModel = (model: Model): boolean =>
  isKimiModel(model) && isSupportedThinkingTokenModel(model)

export const isDeepSeekV4PlusModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return /(?:^|[/:_-])deepseek-v(?:[4-9]|\d{2,})(?:[.\w:-]*)?$/.test(id)
}

/** DeepSeek model that does runtime hybrid inference (thinking / non-thinking at same endpoint). */
export const isDeepSeekHybridInferenceModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return (
    /(\w+-)?deepseek-v3(?:\.\d|-\d)(?:(\.|-)(?!speciale$)\w+)?$/.test(id) ||
    id.includes('deepseek-chat-v3.1') ||
    id.includes('deepseek-chat') ||
    isDeepSeekV4PlusModel(model)
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
    inferOpenAIReasoningFromId(id) ||
    id.includes('hunyuan-t1') ||
    id.includes('hunyuan-a13b') ||
    /glm-?5|glm-4\.[567]|glm-z1/.test(id) ||
    ['mimo-v2.5', 'mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2-omni'].some((m) => id.includes(m)) ||
    /(?:^|[/_-])kimi-k(?:2\.[5-9]\d*|[3-9]\d*(?:\.\d+)?|2-thinking(?:-turbo)?)(?:-[\w-]+)?$/.test(id) ||
    id.includes('mistral-small-2603') ||
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
    id.includes('sonar-deep-research') ||
    inferDeepSeekHybridFromId(id)
  )
}

/**
 * OpenAI reasoning variants: o-series (except preview / mini), GPT-5
 * non-chat, gpt-oss. Mirrors `isSupportedReasoningEffortOpenAIModel`.
 */
function inferOpenAIReasoningFromId(id: string): boolean {
  if (id.includes('o1') && !id.includes('o1-preview') && !id.includes('o1-mini')) return true
  if (id.includes('o3') && !id.includes('o3-mini')) return true
  if (id.startsWith('o3') || id.startsWith('o4')) return true
  if (id.includes('gpt-oss')) return true
  if (id.includes('gpt-5') && !id.includes('chat')) return true
  return false
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

/**
 * Infer whether a raw model ID represents an image-generation-capable model.
 * Covers both the dedicated text-to-image list (`dall-e`, `flux`, …) and the
 * chat-oriented image variants (`gemini-*-flash-image`, `gpt-image-1`, …).
 */
export function inferImageGenerationFromModelId(rawModelId: string): boolean {
  const id = getLowerBaseModelName(rawModelId)
  return DEDICATED_IMAGE_MODEL_REGEX.test(id) || IMAGE_ENHANCEMENT_REGEX.test(id)
}

/** Infer whether a raw model ID represents a web-search-capable model. */
export function inferWebSearchFromModelId(rawModelId: string): boolean {
  const id = getLowerBaseModelName(rawModelId, '/')
  if (CLAUDE_WEBSEARCH_REGEX.test(id)) return true
  if (inferOpenAIWebSearchFromId(id)) return true
  if (GEMINI_SEARCH_REGEX.test(id)) return true
  // Hunyuan: every SKU except hunyuan-lite ships with web search
  if (id.startsWith('hunyuan') && id !== 'hunyuan-lite') return true
  // Perplexity sonar family
  if (/^sonar(?:-|$)/.test(id)) return true
  return false
}

/**
 * Infer whether a raw model ID represents a function-calling-capable model.
 *
 * Precise by construction: rejects embedding / rerank / dedicated image-gen
 * SKUs up-front so the capability stays mutually exclusive with those
 * families. Callers shouldn't need to pre-exclude anything.
 */
export function inferFunctionCallingFromModelId(rawModelId: string): boolean {
  const id = getLowerBaseModelName(rawModelId)
  if (EMBEDDING_REGEX.test(id)) return false
  if (RERANKING_REGEX.test(id)) return false
  if (DEDICATED_IMAGE_MODEL_REGEX.test(id)) return false
  return FUNCTION_CALLING_REGEX.test(id)
}

const FUNCTION_CALLING_ALLOWED_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'gpt-4.5',
  'gpt-oss(?:-[\\w-]+)?',
  'gpt-5(?:-[0-9-]+)?',
  'o(1|3|4)(?:-[\\w-]+)?',
  'claude',
  'qwen',
  'qwen3',
  'hunyuan',
  'deepseek',
  'glm-4(?:-[\\w-]+)?',
  'glm-4.5(?:-[\\w-]+)?',
  'glm-4.7(?:-[\\w-]+)?',
  'glm-5(?:-[\\w-]+)?',
  'learnlm(?:-[\\w-]+)?',
  'gemini(?:-[\\w-]+)?',
  'gemma-?4(?:[-.\\w]+)?',
  'grok-3(?:-[\\w-]+)?',
  'grok-4(?:-[\\w-]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-2[.-]0(?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-k2(?:-[\\w-]+)?',
  'ling-\\w+(?:-[\\w-]+)?',
  'ring-\\w+(?:-[\\w-]+)?',
  'minimax-m2(?:\\.\\d+)?(?:-[\\w-]+)?',
  'mimo-v2\\.5(?:-[\\w-]+)?',
  'mimo-v2-flash',
  'mimo-v2-pro',
  'mimo-v2-omni',
  'glm-5v-turbo'
]

const FUNCTION_CALLING_EXCLUDED_MODELS = [
  'aqa(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'o1-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1',
  'gemini-1(?:\\.[\\w-]+)?',
  'qwen-mt(?:-[\\w-]+)?',
  'gpt-5-chat(?:-[\\w-]+)?',
  'glm-4\\.5v',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?',
  'mimo-v2\\.5-tts(?:-[\\w-]+)?',
  'deepseek-v3.2-speciale'
]

export const FUNCTION_CALLING_REGEX = new RegExp(
  `\\b(?!(?:${FUNCTION_CALLING_EXCLUDED_MODELS.join('|')})\\b)(?:${FUNCTION_CALLING_ALLOWED_MODELS.join('|')})\\b`,
  'i'
)

// ---------------------------------------------------------------------------
// Token limit inference
// ---------------------------------------------------------------------------

const THINKING_TOKEN_MAP: Record<string, { min: number; max: number }> = {
  'gemini-2\\.5-flash-lite.*$': { min: 512, max: 24576 },
  // Gemini -latest aliases (point at the current Gemini 3 flagships).
  'gemini-flash-lite-latest$': { min: 512, max: 24576 },
  'gemini-flash-latest$': { min: 0, max: 24576 },
  'gemini-pro-latest$': { min: 128, max: 32768 },
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
  // `qwen-max-latest` is a distinct alias — the versioned `qwen-max-2025-09-23`
  // is explicitly excluded because that SKU predates thinking-token support.
  'qwen-max-latest$': { min: 0, max: 81_920 },
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
  '(?:anthropic\\.)?claude-opus-4[.-]7(?:[@-](?:\\d{4,}|[a-z][\\w-]*))?(?:-v\\d+:\\d+)?$': {
    min: 1024,
    max: 128_000
  },
  '(?:anthropic\\.)?claude-3[.-]7.*sonnet.*(?:-v\\d+:\\d+)?$': { min: 1024, max: 64_000 },
  'baichuan-m2$': { min: 0, max: 30_000 },
  'baichuan-m3$': { min: 0, max: 30_000 },
  'gemma-?4[:-]?e[24]b': { min: 1024, max: 8192 },
  'gemma-?4[:-]?26b': { min: 1024, max: 30720 },
  'gemma-?4[:-]?31b': { min: 1024, max: 30720 },
  // Hunyuan — only hunyuan-a13b exposes the knob today.
  'hunyuan-a13b': { min: 0, max: 30_720 },
  // Zhipu / GLM — GLM-5 and GLM-4.5 / 4.6 / 4.7. Unanchored to handle
  // provider-prefixed ids (zhipu/glm-4.6, fireworks normalized form).
  'glm-?5|glm-4\\.[567]': { min: 0, max: 30_720 },
  // MiMo v2 family.
  'mimo-v2\\.5(?:-[\\w-]+)?': { min: 0, max: 30_720 },
  'mimo-v2-(?:flash|pro|omni)': { min: 0, max: 30_720 },
  // Kimi K2.5 and newer.
  'kimi-k(?:2\\.[5-9]\\d*|[3-9]\\d*(?:\\.\\d+)?)': { min: 0, max: 30_720 },
  // Doubao thinking SKUs (mirrors DOUBAO_THINKING_MODEL_REGEX scope).
  // The `(?!-thinking(?:-|$))` lookahead excludes always-thinking seed variants.
  'doubao-(?:1[.-]5-thinking-vision-pro|1[.-]5-thinking-pro-m|seed-1[.-][68](?:-flash)?(?!-thinking(?:-|$))|seed-code(?:-preview)?(?:-\\d+)?|seed-2[.-]0(?:-[\\w-]+)?)(?:-[\\w-]+)*':
    { min: 0, max: 30_720 }
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

export const EMBEDDING_REGEX =
  /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i

export const RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i

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
  'gemini-3(?:\\.\\d+)?-(?:flash|pro)-image(?:-[\\w-]+)?'
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
  'kimi-k2\\.[56](?:-[\\w-]+)?',
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
  'mistral-small-(2603|2506|latest)',
  'mimo-v2\\.5$',
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
  return model.apiModelId ?? parseUniqueModelId(model.id).modelId
}

// ════════════════════════════════════════════════════════════════════════════
// Section 3 — Family-specific reasoning / variant checks
//
// All of these are pure ID-based inference (no runtime state), safe to call
// from both main and renderer. They complement the capability-schema-driven
// runtime checks in Section 1 for legacy code paths that never populated
// the schema fields.
// ════════════════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Family reasoning checks
// ---------------------------------------------------------------------------

// All "<vendor>ReasoningModel" checks compose the ID-based vendor check
// with the schema-driven capability check. The registry populates the
// REASONING capability at model-creation time via inferReasoningFromModelId,
// so these functions read truth from the schema rather than duplicating
// regex patterns here.

export const isGeminiReasoningModel = (model: Model): boolean => isGeminiModel(model) && isReasoningModel(model)

export const isGrokReasoningModel = (model: Model): boolean => isGrokModel(model) && isReasoningModel(model)

export const isHunyuanReasoningModel = (model: Model): boolean => isHunyuanModel(model) && isReasoningModel(model)

export const isZhipuReasoningModel = (model: Model): boolean => isZhipuModel(model) && isReasoningModel(model)

/**
 * Kimi reasoning identifier. Kept stricter than `isKimiModel && isReasoningModel`:
 * `REASONING_REGEX` matches any id containing "thinking", which overshoots onto
 * variants like `kimi-k2-thinking-extra` that are not official reasoning SKUs.
 * Pinning to the canonical IDs avoids that false positive.
 */
export const isKimiReasoningModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model), '/')
  return /^kimi-k2-thinking(?:-turbo)?$|^kimi-k(?:2\.[5-9]\d*|[3-9]\d*(?:\.\d+)?)(?:-[\w-]+)?$/.test(id)
}

export const isBaichuanReasoningModel = (model: Model): boolean => isBaichuanModel(model) && isReasoningModel(model)

export const isLingReasoningModel = (model: Model): boolean => isLingModel(model) && isReasoningModel(model)

export const isMiniMaxReasoningModel = (model: Model): boolean => isMiniMaxModel(model) && isReasoningModel(model)

export const isStepReasoningModel = (model: Model): boolean => isStepModel(model) && isReasoningModel(model)

export const isPerplexityReasoningModel = (model: Model): boolean => isPerplexityModel(model) && isReasoningModel(model)

export const isSupportedReasoningEffortPerplexityModel = (model: Model): boolean =>
  isPerplexityModel(model) && isSupportedReasoningEffortModel(model)

/**
 * GPT-5 series reasoning variants are identified by series membership plus
 * the REASONING capability — the `chat` SKU is carved out of the series
 * check by `isGPT5SeriesModel` already, so no extra ID filter is needed.
 */
export const isGPT5SeriesReasoningModel = (model: Model): boolean => isGPT5SeriesModel(model) && isReasoningModel(model)

/** Alias: MiMo reasoning support mirrors thinking-token support. */
export const isMiMoReasoningModel = (model: Model): boolean => isMiMoModel(model) && isReasoningModel(model)

/** Alias preserved for callers — DeepSeek's thinking-token support equals its hybrid inference flag. */
export const isSupportedThinkingTokenDeepSeekModel = isDeepSeekHybridInferenceModel

// ---------------------------------------------------------------------------
// Specific Gemini / GPT / Kimi variants
// ---------------------------------------------------------------------------

/** Gemini 3 Flash (excludes image variant). `gemini-flash-latest` alias currently points here. */
export const isGemini3FlashModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  if (id === 'gemini-flash-latest') return true
  return /gemini-3-flash(?!-image)(?:-[\w-]+)*$/i.test(id)
}

/** Gemini 3 Pro (excludes image variant). */
export const isGemini3ProModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return /gemini-3-pro(?!-image)(?:-[\w-]+)*$/i.test(id)
}

/** Gemini 3.1 Flash Lite preview. */
export const isGemini31FlashLiteModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  return /gemini-3\.1-flash-lite(?:-[\w-]+)*$/i.test(id)
}

/** Gemini 3.1 Pro (excludes image variant). `gemini-pro-latest` alias currently points here. */
export const isGemini31ProModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  if (id === 'gemini-pro-latest') return true
  return /gemini-3.1-pro(?!-image)(?:-[\w-]+)*$/i.test(id)
}

/** GPT-5.2 pro variant. */
export const isGPT52ProModel = (model: Model): boolean =>
  getLowerBaseModelName(getRawModelId(model)).includes('gpt-5.2-pro')

/** Kimi K2.5 — the variant that has its own parameter constraints (fixed temperature / top_p). */
export const isKimi25OrNewerModel = (model: Model): boolean =>
  /kimi-k(?:2\.[5-9]\d*|[3-9]\d*)/.test(getLowerBaseModelName(getRawModelId(model)))

/** Gemma family (including Ollama `gemma4:*` tag). Falls back to `model.group`. */
export const isGemmaModel = (model: Model): boolean => {
  if (VENDOR_PATTERNS.gemma.test(getLowerBaseModelName(getRawModelId(model)))) return true
  return (model as Model & { group?: string }).group === 'Gemma'
}

/** Moonshot / Kimi family (alias for isKimiModel; kept for legacy callers). */
export const isMoonshotModel = isKimiModel

/** Zhipu GLM family (id match or providerId). */
export const isZhipuModel = (model: Model): boolean =>
  VENDOR_PATTERNS.zhipu.test(getLowerBaseModelName(getRawModelId(model))) || model.providerId === 'zhipu'

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

/**
 * Hunyuan model with web-search capability. Same layered composition:
 * vendor gate + capability check (registry-populated).
 */
export const isHunyuanSearchModel = (model: Model): boolean => isHunyuanModel(model) && isWebSearchModel(model)

// ---------------------------------------------------------------------------
// Capability limits
// ---------------------------------------------------------------------------

const NOT_SUPPORT_TEXT_DELTA_REGEX = /qwen-mt-(?:turbo|plus)/

/** Models that emit full text turns instead of text-delta chunks. */
export const isNotSupportTextDeltaModel = (model: Model): boolean =>
  NOT_SUPPORT_TEXT_DELTA_REGEX.test(getLowerBaseModelName(getRawModelId(model)))

/**
 * Models that reject a system message. Prefers the schema-populated
 * `parameterSupport.systemMessage` when available; falls back to the
 * family rule (Qwen MT + Gemma) for models that predate the schema field.
 */
export const isNotSupportSystemMessageModel = (model: Model): boolean => {
  if (model.parameterSupport?.systemMessage === false) return true
  return isQwenMTModel(model) || isGemmaModel(model)
}

// ---------------------------------------------------------------------------
// Collection checks
// ---------------------------------------------------------------------------

/** All models in the list are vision-capable. */
export const isVisionModels = (models: readonly Model[]): boolean => models.every(isVisionModel)

/** All models in the list are image-generation-capable. */
export const isGenerateImageModels = (models: readonly Model[]): boolean => models.every(isGenerateImageModel)
