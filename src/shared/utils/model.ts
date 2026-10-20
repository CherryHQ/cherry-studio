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

import { endpointImpliedCapability, MODALITY, modelMatchId, VENDOR_PATTERNS } from '@cherrystudio/provider-registry'
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

// Prefer the explicit AUDIO_TRANSCRIPT capability. Catalogs that only expose
// modalities still identify a dedicated ASR model by audio input + text output
// with no text input. The no-text-input guard keeps multimodal chat LLMs
// (Gemini, GPT-4o, …) selectable.
export const isSpeechToTextModel = (model: Model): boolean =>
  model.capabilities.includes(MODEL_CAPABILITY.AUDIO_TRANSCRIPT) ||
  (model.capabilities.includes(MODEL_CAPABILITY.AUDIO_RECOGNITION) &&
    model.inputModalities?.includes(MODALITY.AUDIO) === true &&
    !model.inputModalities.includes(MODALITY.TEXT) &&
    model.outputModalities?.includes(MODALITY.TEXT) === true)

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
  endpointImpliedCapability(model.endpointTypes?.[0]) != null ||
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

// Vendor identity checks all delegate to `VENDOR_PATTERNS` in
// `@cherrystudio/provider-registry`. Do NOT inline new regex here —
// add the vendor to the registry's pattern map instead of duplicating
// regexes in renderer code.

/** Check if model is an Anthropic/Claude model */
export const isAnthropicModel = (model: Model): boolean =>
  VENDOR_PATTERNS.anthropic.test(modelMatchId(getRawModelId(model)))

/** Check if model is a Gemini model */
export const isGeminiModel = (model: Model): boolean => VENDOR_PATTERNS.gemini.test(modelMatchId(getRawModelId(model)))

/** Check if model is a Grok model */
export const isGrokModel = (model: Model): boolean => VENDOR_PATTERNS.grok.test(modelMatchId(getRawModelId(model)))

/** Check if model is an OpenAI model (GPT or o-series) */
export const isOpenAIModel = (model: Model): boolean => VENDOR_PATTERNS.openai.test(modelMatchId(getRawModelId(model)))

/** Check if model is a Qwen family model (all variants, including qwq/qvq). */
export const isQwenModel = (model: Model): boolean => VENDOR_PATTERNS.qwen.test(modelMatchId(getRawModelId(model)))

/** Check if model is a DeepSeek model. */
export const isDeepSeekModel = (model?: Model): boolean => {
  if (!model) return false
  if (VENDOR_PATTERNS.deepseek.test(modelMatchId(getRawModelId(model)))) return true
  if (model.providerId === 'deepseek') return true
  return model.name ? VENDOR_PATTERNS.deepseek.test(model.name.toLowerCase()) : false
}

/** Check if model is a pure image generation model (no tool use) */
export const isPureGenerateImageModel = (model: Model): boolean => {
  if (!isGenerateImageModel(model) && !isTextToImageModel(model)) return false
  if (isFunctionCallingModel(model)) return false
  return true
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

/**
 * Derive the model-list group from an API model ID.
 *
 * Provider-prefixed IDs use the provider segment (`openai/gpt-4o` → `openai`);
 * flat IDs use their family prefix (`deepseek-v4-pro` → `deepseek`).
 */
export function deriveModelGroupName(modelId: string): string | undefined {
  const normalizedId = modelId.trim()
  const pathParts = normalizedId.split('/')
  if (pathParts.length > 1) {
    return pathParts[0]?.trim() || undefined
  }

  const familyName = normalizedId.split('-')[0]?.trim()
  return familyName && familyName !== normalizedId ? familyName : undefined
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
// Extract the raw (wire) model ID from a Model
// ---------------------------------------------------------------------------

/**
 * The wire id every id-based predicate must key off. `apiModelId` is optional
 * or empty on the runtime Model, so reading it alone silently misidentifies models whose
 * unique id carries the wire name instead.
 */
export function getRawModelId(model: Model): string {
  return model.apiModelId || parseUniqueModelId(model.id).modelId
}
