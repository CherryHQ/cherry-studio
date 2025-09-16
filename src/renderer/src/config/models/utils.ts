import { Model } from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'
import OpenAI from 'openai'

import { WEB_SEARCH_PROMPT_FOR_OPENROUTER } from '../prompts'
import { getWebSearchTools } from '../tools'
import { isOpenAIReasoningModel } from './reasoning'
import { isGenerateImageModel, isVisionModel } from './vision'
import { isOpenAIWebSearchChatCompletionOnlyModel } from './websearch'
export const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i

export const OPENAI_NO_SUPPORT_DEV_ROLE_MODELS = ['o1-preview', 'o1-mini']

export function isOpenAILLMModel(model: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)

  if (modelId.includes('gpt-4o-image')) {
    return false
  }
  if (isOpenAIReasoningModel(model)) {
    return true
  }
  if (modelId.includes('gpt')) {
    return true
  }
  return false
}

export function isOpenAIModel(model: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)

  return modelId.includes('gpt') || isOpenAIReasoningModel(model)
}

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

export function isSupportVerbosityModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return isGPT5SeriesModel(model) && !modelId.includes('chat')
}

export function isOpenAIChatCompletionOnlyModel(model: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return (
    modelId.includes('gpt-4o-search-preview') ||
    modelId.includes('gpt-4o-mini-search-preview') ||
    modelId.includes('o1-mini') ||
    modelId.includes('o1-preview')
  )
}

export function isGrokModel(model?: Model): boolean {
  if (!model) {
    return false
  }
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('grok')
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

export function getOpenAIWebSearchParams(model: Model, isEnableWebSearch?: boolean): Record<string, any> {
  if (!isEnableWebSearch) {
    return {}
  }

  const webSearchTools = getWebSearchTools(model)

  if (model.provider === 'grok') {
    return {
      search_parameters: {
        mode: 'auto',
        return_citations: true,
        sources: [{ type: 'web' }, { type: 'x' }, { type: 'news' }]
      }
    }
  }

  if (model.provider === 'hunyuan') {
    return { enable_enhancement: true, citation: true, search_info: true }
  }

  if (model.provider === 'dashscope') {
    return {
      enable_search: true,
      search_options: {
        forced_search: true
      }
    }
  }

  if (isOpenAIWebSearchChatCompletionOnlyModel(model)) {
    return {
      web_search_options: {}
    }
  }

  if (model.provider === 'openrouter') {
    return {
      plugins: [{ id: 'web', search_prompts: WEB_SEARCH_PROMPT_FOR_OPENROUTER }]
    }
  }

  return {
    tools: webSearchTools
  }
}

export function isGemmaModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gemma-') || model.group === 'Gemma'
}

export function isZhipuModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  return model.provider === 'zhipu'
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

export const isQwenMTModel = (model: Model): boolean => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('qwen-mt')
}

export const isNotSupportedTextDelta = (model: Model): boolean => {
  return isQwenMTModel(model)
}

export const isNotSupportSystemMessageModel = (model: Model): boolean => {
  return isQwenMTModel(model) || isGemmaModel(model)
}

export const isGPT5SeriesModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-5')
}

export const isGPT5SeriesReasoningModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-5') && !modelId.includes('chat')
}

export const isGeminiModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gemini')
}

export const isOpenAIOpenWeightModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-oss')
}

// zhipu 视觉推理模型用这组 special token 标记推理结果
export const ZHIPU_RESULT_TOKENS = ['<|begin_of_box|>', '<|end_of_box|>'] as const
