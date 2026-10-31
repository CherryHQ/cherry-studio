import { getLowerBaseModelName } from '@renderer/utils/naming'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import {
  isAnthropicModel as sharedIsAnthropicModel,
  isAudioModel as sharedIsAudioModel,
  isDeepSeekModel as sharedIsDeepSeekModel,
  isGeminiModel as sharedIsGeminiModel,
  isGrokModel as sharedIsGrokModel,
  isVideoModel as sharedIsVideoModel
} from '@shared/utils/model'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { isGenerateImageModel, isTextToImageModel, isVisionModel } from './vision'

// ── Re-exports (public API preserved) ─────────────────────────────────────
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

// ── Family checks (delegated to shared) ─────────────────────────────────
export const isAnthropicModel = (model?: Model): boolean => (model ? sharedIsAnthropicModel(model) : false)

export const isDeepSeekModel = (model?: Model): boolean => (model ? sharedIsDeepSeekModel(model) : false)

export const isAudioModel = (model: Model): boolean => sharedIsAudioModel(model)

export const isVideoModel = (model: Model): boolean => sharedIsVideoModel(model)

export const isGeminiModel = (model: Model): boolean => sharedIsGeminiModel(model)

export const isGrokModel = (model: Model): boolean => sharedIsGrokModel(model)

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

// ── Renderer-only constants ──────────────────────────────────────────────
// zhipu 视觉推理模型用这组 special token 标记推理结果
export const ZHIPU_RESULT_TOKENS = ['<|begin_of_box|>', '<|end_of_box|>'] as const

// ── Agent filter (composes local renderer functions) ─────────────────────
export const agentModelFilter = (model: Model): boolean => {
  return !isEmbeddingModel(model) && !isRerankModel(model) && !isTextToImageModel(model)
}
