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

/** Check if model is a MiniMax model. */
export const isMiniMaxModel = vendorCheck(VENDOR_PATTERNS.minimax)

/** Check if model is a MiMo (Xiaomi) model. */
export const isMiMoModel = vendorCheck(VENDOR_PATTERNS.mimo)

/**
 * OpenAI reasoning model = OpenAI vendor + REASONING capability.
 * The registry populates REASONING via the registry membership
 * heuristics (o-series, GPT-5 non-chat, gpt-oss), so the capability is the
 * right source of truth here — no need to re-check IDs at runtime.
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
 * OpenAI reasoning-effort support = OpenAI vendor + selectable efforts populated.
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
 * (including the `*-latest` aliases) that the registry membership heuristics
 * recognise, so the capability is populated on exactly the same SKUs the
 * legacy regex used to gate on.
 */
export const isSupportedThinkingTokenGeminiModel = (model: Model): boolean =>
  (isGeminiModel(model) || isHostedGemma4ThinkingModel(model)) && isSupportedThinkingTokenModel(model)

/**
 * Grok reasoning-effort support = Grok vendor + selectable efforts populated. The
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
 * populates REASONING via the registry membership heuristics (QwQ / QVQ /
 * qwen3* thinking / qwen3-max / qwen-plus / etc.), so the capability is the right
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
 * THINKING_TOKEN_MAP mirrors the doubao membership pattern for SKU coverage.
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
 * Covers `mimo-v2-flash / pro / omni` via THINKING_TOKEN_MAP.
 */
export const isSupportedThinkingTokenMiMoModel = (model: Model): boolean =>
  isMiMoModel(model) && isSupportedThinkingTokenModel(model)

/**
 * Kimi thinking-token support = Kimi vendor + `thinkingTokenLimits`.
 * Only `kimi-k2.5` currently ships the knob.
 */
export const isSupportedThinkingTokenKimiModel = (model: Model): boolean =>
  isKimiModel(model) && isSupportedThinkingTokenModel(model)

const isDeepSeekV4PlusId = (id: string): boolean =>
  /deepseek-v(?:[4-9]\d*|[1-9]\d{1,})(?:\.\d+)?(?:-[\w]+)*(?=$|[:/])/i.test(id)

export const isDeepSeekV4PlusModel = (model: Model): boolean => {
  const id = getLowerBaseModelName(getRawModelId(model))
  const name = getLowerBaseModelName(model.name ?? '')
  return isDeepSeekV4PlusId(id) || isDeepSeekV4PlusId(name)
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

export const DOUBAO_THINKING_AUTO_MODEL_REGEX =
  /doubao-(1-5-thinking-pro-m|seed-1[.-]6)(?!-(?:flash|thinking)(?:-|$))(?:-lite)?(?!-251015)(?:-\d+)?$/i

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
// REASONING capability at model-creation time via the registry membership heuristics,
// so these functions read truth from the schema rather than duplicating
// regex patterns here.

/**
 * GPT-5 series reasoning variants are identified by series membership plus
 * the REASONING capability — the `chat` SKU is carved out of the series
 * check by `isGPT5SeriesModel` already, so no extra ID filter is needed.
 */
export const isGPT5SeriesReasoningModel = (model: Model): boolean => isGPT5SeriesModel(model) && isReasoningModel(model)

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
