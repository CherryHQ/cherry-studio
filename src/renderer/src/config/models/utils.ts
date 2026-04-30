import { type Model } from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'
import type { OpenAIVerbosity, ValidOpenAIVerbosity } from '@shared/types/aiSdk'
import {
  GEMINI_FLASH_MODEL_REGEX as SHARED_GEMINI_FLASH_MODEL_REGEX,
  isAnthropicModel as sharedIsAnthropicModel,
  isClaude46SeriesModel as sharedIsClaude46SeriesModel,
  isGemini3FlashModel as sharedIsGemini3FlashModel,
  isGemini3Model as sharedIsGemini3Model,
  isGemini3ProModel as sharedIsGemini3ProModel,
  isGemini3ThinkingTokenModel as sharedIsGemini3ThinkingTokenModel,
  isGemini31FlashLiteModel as sharedIsGemini31FlashLiteModel,
  isGemini31ProModel as sharedIsGemini31ProModel,
  isGeminiModel as sharedIsGeminiModel,
  isGemmaModel as sharedIsGemmaModel,
  isGrokModel as sharedIsGrokModel,
  isKimi25OrNewerModel as sharedIsKimi25OrNewerModel,
  isMaxTemperatureOneModel as sharedIsMaxTemperatureOneModel,
  isMoonshotModel as sharedIsMoonshotModel,
  isNotSupportSystemMessageModel as sharedIsNotSupportSystemMessageModel,
  isNotSupportTextDeltaModel as sharedIsNotSupportTextDeltaModel,
  isSupportFlexServiceTierModel as sharedIsSupportFlexServiceTierModel,
  isZhipuModel as sharedIsZhipuModel
} from '@shared/utils/model'

import { toSharedCompatModel } from './_bridge'
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

// ── Renderer-only utility: id vs name fallback pattern ─────────────────────
export const withModelIdAndNameAsId = <T>(model: Model, fn: (model: Model) => T): { idResult: T; nameResult: T } => {
  const modelWithNameAsId = { ...model, id: model.name }
  return {
    idResult: fn(model),
    nameResult: fn(modelWithNameAsId)
  }
}

// ── Service-tier / endpoint support ────────────────────────────────────────
export const isSupportFlexServiceTierModel = (model: Model): boolean =>
  sharedIsSupportFlexServiceTierModel(toSharedCompatModel(model))

export const isSupportedFlexServiceTier = isSupportFlexServiceTierModel

// ── Family checks (delegated to shared) ─────────────────────────────────
export const isGemmaModel = (model?: Model): boolean => (model ? sharedIsGemmaModel(toSharedCompatModel(model)) : false)

export const isZhipuModel = (model: Model): boolean => sharedIsZhipuModel(toSharedCompatModel(model))

export const isMoonshotModel = (model: Model): boolean => sharedIsMoonshotModel(toSharedCompatModel(model))

export const isKimi25OrNewerModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsKimi25OrNewerModel(toSharedCompatModel(model)) : false

export const isAnthropicModel = (model?: Model): boolean =>
  model ? sharedIsAnthropicModel(toSharedCompatModel(model)) : false

export const isGeminiModel = (model: Model): boolean => sharedIsGeminiModel(toSharedCompatModel(model))

export const isGrokModel = (model: Model): boolean => sharedIsGrokModel(toSharedCompatModel(model))

export const isGemini3Model = (model: Model): boolean => sharedIsGemini3Model(toSharedCompatModel(model))

export const isGemini3ThinkingTokenModel = (model: Model): boolean =>
  sharedIsGemini3ThinkingTokenModel(toSharedCompatModel(model))

export const isGemini3FlashModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsGemini3FlashModel(toSharedCompatModel(model)) : false

export const isGemini31FlashLiteModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsGemini31FlashLiteModel(toSharedCompatModel(model)) : false

export const isGemini3ProModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsGemini3ProModel(toSharedCompatModel(model)) : false

export const isGemini31ProModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsGemini31ProModel(toSharedCompatModel(model)) : false

export const isClaude46SeriesModel = (model: Model | undefined | null): boolean =>
  model ? sharedIsClaude46SeriesModel(toSharedCompatModel(model)) : false

export const isMaxTemperatureOneModel = (model: Model): boolean =>
  sharedIsMaxTemperatureOneModel(toSharedCompatModel(model))

export const isNotSupportTextDeltaModel = (model: Model): boolean =>
  sharedIsNotSupportTextDeltaModel(toSharedCompatModel(model))

export const isNotSupportSystemMessageModel = (model: Model): boolean =>
  sharedIsNotSupportSystemMessageModel(toSharedCompatModel(model))

// ── Collections ─────────────────────────────────────────────────────────
// Use the renderer's own inference-based vision/image checks (which honour
// user preferences). Shared's schema-driven equivalents would crash on v1
// Model (no `capabilities` populated).
export const isVisionModels = (models: Model[]): boolean => models.every(isVisionModel)

export const isGenerateImageModels = (models: Model[]): boolean => models.every(isGenerateImageModel)

// ── Renderer-only data grouping ─────────────────────────────────────────
/**
 * 按 Qwen 系列模型分组
 */
export function groupQwenModels(models: Model[]): Record<string, Model[]> {
  return models.reduce(
    (groups, model) => {
      const modelId = getLowerBaseModelName(model.id)
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
      const modelId = getLowerBaseModelName(model.id)
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
