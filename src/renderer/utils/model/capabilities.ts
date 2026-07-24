import { getLowerBaseModelName } from '@renderer/utils/naming'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { OpenAIVerbosity, ValidOpenAIVerbosity } from '@shared/types/aiSdk'
import {
  GEMINI_FLASH_MODEL_REGEX as SHARED_GEMINI_FLASH_MODEL_REGEX,
  isAnthropicModel as sharedIsAnthropicModel,
  isAudioModel as sharedIsAudioModel,
  isClaude46SeriesModel as sharedIsClaude46SeriesModel,
  isClaude47SeriesModel as sharedIsClaude47SeriesModel,
  isDeepSeekModel as sharedIsDeepSeekModel,
  isGemini3Model as sharedIsGemini3Model,
  isGeminiModel as sharedIsGeminiModel,
  isGrokModel as sharedIsGrokModel,
  isMaxTemperatureOneModel as sharedIsMaxTemperatureOneModel,
  isSupportFlexServiceTierModel as sharedIsSupportFlexServiceTierModel,
  isVideoModel as sharedIsVideoModel
} from '@shared/utils/model'

import { isEmbeddingModel, isRerankModel } from './embedding'
import {
  isGPT5FamilyModel,
  isGPT5SeriesModel,
  isGPT51SeriesModel,
  isGPT52SeriesModel,
  isSupportVerbosityModel
} from './openai'
import { isGenerateImageModel, isTextToImageModel, isVisionModel } from './vision'

// ── Re-exports (public API preserved) ─────────────────────────────────────
export const GEMINI_FLASH_MODEL_REGEX = SHARED_GEMINI_FLASH_MODEL_REGEX
export const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i

/** Raw model id (provider prefix stripped) for renderer-local string ops. */
export const getRawModelId = (model: Model): string => model.apiModelId ?? parseUniqueModelId(model.id).modelId

// ── Renderer-only utility: id vs name fallback pattern ─────────────────────
// Legacy v1 data sometimes stored the real id under `name`. v2 ids are
// canonical, but a few renderer checks still try name as a fallback.
export const withModelIdAndNameAsId = <T>(model: Model, fn: (model: Model) => T): { idResult: T; nameResult: T } => {
  const modelWithNameAsId = { ...model, apiModelId: model.name }
  return {
    idResult: fn(model),
    nameResult: fn(modelWithNameAsId)
  }
}

// ── Service-tier / endpoint support ────────────────────────────────────────
export const isSupportFlexServiceTierModel = (model: Model): boolean => sharedIsSupportFlexServiceTierModel(model)

export const isSupportedFlexServiceTier = isSupportFlexServiceTierModel

// ── Family checks (delegated to shared) ─────────────────────────────────
export const isAnthropicModel = (model?: Model): boolean => (model ? sharedIsAnthropicModel(model) : false)

export const isDeepSeekModel = (model?: Model): boolean => (model ? sharedIsDeepSeekModel(model) : false)

export const isAudioModel = (model: Model): boolean => sharedIsAudioModel(model)

export const isVideoModel = (model: Model): boolean => sharedIsVideoModel(model)

export const isGeminiModel = (model: Model): boolean => sharedIsGeminiModel(model)

export const isGrokModel = (model: Model): boolean => sharedIsGrokModel(model)

export const isGemini3Model = (model: Model): boolean => sharedIsGemini3Model(model)

export const isClaude46SeriesModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsClaude46SeriesModel(model) : false

export const isClaude47SeriesModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsClaude47SeriesModel(model) : false

export const isMaxTemperatureOneModel = (model: Model): boolean => sharedIsMaxTemperatureOneModel(model)

// ── Collections ─────────────────────────────────────────────────────────
export const isVisionModels = (models: Model[]): boolean => models.every(isVisionModel)

export const isGenerateImageModels = (models: Model[]): boolean => models.every(isGenerateImageModel)

export const isAudioModels = (models: Model[]): boolean => models.every(isAudioModel)

export const isVideoModels = (models: Model[]): boolean => models.every(isVideoModel)

// ── Renderer-only data grouping ─────────────────────────────────────────
/**
 * 按 Qwen 系列模型分组
 */
export function groupQwenModels(models: Model[]): Record<string, Model[]> {
  return models.reduce(
    (groups, model) => {
      const modelId = getLowerBaseModelName(getRawModelId(model))
      const prefixMatch = modelId.match(/^(qwen(?:\d+\.\d+|2(?:\.\d+)?|-\d+b|-(?:max|coder|vl)))/i)
      const groupKey = prefixMatch ? prefixMatch[1] : model.group || '其他'
      if (!groups[groupKey]) groups[groupKey] = []
      groups[groupKey].push(model)
      return groups
    },
    {} as Record<string, Model[]>
  )
}

// ── Renderer-only: verbosity (uses OpenAIVerbosity type) ─────────────────
const MODEL_SUPPORTED_VERBOSITY: readonly {
  readonly validator: (model: Model) => boolean
  readonly values: readonly ValidOpenAIVerbosity[]
}[] = [
  {
    validator: (model: Model) => !isSupportVerbosityModel(model),
    values: []
  },
  {
    validator: (model: Model) => {
      const modelId = getLowerBaseModelName(getRawModelId(model))
      if (modelId.includes('chat')) return false
      if (modelId.includes('codex')) {
        if (isGPT5SeriesModel(model) || isGPT51SeriesModel(model) || isGPT52SeriesModel(model)) return false
        return true
      }
      return isGPT5FamilyModel(model)
    },
    values: ['low', 'medium', 'high']
  },
  {
    validator: isGPT5FamilyModel,
    values: ['medium']
  }
]

export const getModelSupportedVerbosity = (model: Model | undefined | null): OpenAIVerbosity[] => {
  if (!model || !isSupportVerbosityModel(model)) return [undefined]
  let supportedValues: ValidOpenAIVerbosity[] = []
  for (const { validator, values } of MODEL_SUPPORTED_VERBOSITY) {
    if (validator(model)) {
      supportedValues = [null, ...values]
      break
    }
  }
  return [undefined, ...supportedValues]
}

// ── Renderer-only constants ──────────────────────────────────────────────
// zhipu 视觉推理模型用这组 special token 标记推理结果
export const ZHIPU_RESULT_TOKENS = ['<|begin_of_box|>', '<|end_of_box|>'] as const

// ── Agent filter (composes local renderer functions) ─────────────────────
export const agentModelFilter = (model: Model): boolean => {
  return !isEmbeddingModel(model) && !isRerankModel(model) && !isTextToImageModel(model)
}
