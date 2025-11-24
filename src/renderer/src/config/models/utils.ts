import type OpenAI from '@cherrystudio/openai'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models/embedding'
import { type Model, SystemProviderIds } from '@renderer/types'
import type { OpenAIVerbosity, ValidOpenAIVerbosity } from '@renderer/types/aiCoreTypes'
import { getLowerBaseModelName } from '@renderer/utils'

import { isOpenAIChatCompletionOnlyModel, isOpenAIOpenWeightModel, isOpenAIReasoningModel } from './openai'
import { isQwenMTModel } from './qwen'
import { isGenerateImageModel, isTextToImageModel, isVisionModel } from './vision'
export const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i
export const GEMINI_FLASH_MODEL_REGEX = new RegExp('gemini.*-flash.*$', 'i')

export function isSupportFlexServiceTierModel(model: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)
  return (
    (modelId.includes('o3') && !modelId.includes('o3-mini')) || modelId.includes('o4-mini') || modelId.includes('gpt-5')
  )
}
export function isSupportedFlexServiceTier(model: Model): boolean {
  return isSupportFlexServiceTierModel(model)
}

export function isSupportedModel(model: OpenAI.Models.Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  return !NOT_SUPPORTED_REGEX.test(modelId)
}

export function isNotSupportTemperatureAndTopP(model: Model): boolean {
  if (!model) {
    return true
  }

  if (
    (isOpenAIReasoningModel(model) && !isOpenAIOpenWeightModel(model)) ||
    isOpenAIChatCompletionOnlyModel(model) ||
    isQwenMTModel(model)
  ) {
    return true
  }

  return false
}

export function isGemmaModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gemma-') || model.group === 'Gemma'
}

export function isZhipuModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('glm') || model.provider === SystemProviderIds.zhipu
}

export function isMoonshotModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return ['moonshot', 'kimi'].some((m) => modelId.includes(m))
}

/**
 * 按 Qwen 系列模型分组
 * @param models 模型列表
 * @returns 分组后的模型
 */
export function groupQwenModels(models: Model[]): Record<string, Model[]> {
  return models.reduce(
    (groups, model) => {
      const modelId = getLowerBaseModelName(model.id)
      // 匹配 Qwen 系列模型的前缀
      const prefixMatch = modelId.match(/^(qwen(?:\d+\.\d+|2(?:\.\d+)?|-\d+b|-(?:max|coder|vl)))/i)
      // 匹配 qwen2.5、qwen2、qwen-7b、qwen-max、qwen-coder 等
      const groupKey = prefixMatch ? prefixMatch[1] : model.group || '其他'

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(model)

      return groups
    },
    {} as Record<string, Model[]>
  )
}

// 模型集合功能测试
export const isVisionModels = (models: Model[]) => {
  return models.every((model) => isVisionModel(model))
}

export const isGenerateImageModels = (models: Model[]) => {
  return models.every((model) => isGenerateImageModel(model))
}

export const isAnthropicModel = (model?: Model): boolean => {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return modelId.startsWith('claude')
}

export const isNotSupportedTextDelta = (model: Model): boolean => {
  return isQwenMTModel(model)
}

export const isNotSupportSystemMessageModel = (model: Model): boolean => {
  return isQwenMTModel(model) || isGemmaModel(model)
}

// GPT-5 verbosity configuration
// gpt-5-pro only supports 'high', other GPT-5 models support all levels
export const MODEL_SUPPORTED_VERBOSITY: Record<string, ValidOpenAIVerbosity[]> = {
  'gpt-5-pro': ['high'],
  default: ['low', 'medium', 'high']
} as const

export const getModelSupportedVerbosity = (model: Model): OpenAIVerbosity[] => {
  const modelId = getLowerBaseModelName(model.id)
  let supportedValues: ValidOpenAIVerbosity[]
  if (modelId.includes('gpt-5-pro')) {
    supportedValues = MODEL_SUPPORTED_VERBOSITY['gpt-5-pro']
  } else {
    supportedValues = MODEL_SUPPORTED_VERBOSITY.default
  }
  return [undefined, ...supportedValues]
}

export const isGeminiModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gemini')
}

// zhipu 视觉推理模型用这组 special token 标记推理结果
export const ZHIPU_RESULT_TOKENS = ['<|begin_of_box|>', '<|end_of_box|>'] as const

export const agentModelFilter = (model: Model): boolean => {
  return !isEmbeddingModel(model) && !isRerankModel(model) && !isTextToImageModel(model)
}

export const isMaxTemperatureOneModel = (model: Model): boolean => {
  if (isZhipuModel(model) || isAnthropicModel(model) || isMoonshotModel(model)) {
    return true
  }
  return false
}

export const isGemini3Model = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gemini-3')
}
