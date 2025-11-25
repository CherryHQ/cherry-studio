import type { Model } from '@renderer/types'
import { getLowerBaseModelName } from '@renderer/utils'

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

export const isGPT5ProModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-5-pro')
}

export const isOpenAIOpenWeightModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-oss')
}

export const isGPT5SeriesModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-5') && !modelId.includes('gpt-5.1')
}

export const isGPT5SeriesReasoningModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return isGPT5SeriesModel(model) && !modelId.includes('chat')
}

export const isGPT51SeriesModel = (model: Model) => {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-5.1')
}

export function isSupportVerbosityModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return (isGPT5SeriesModel(model) || isGPT51SeriesModel(model)) && !modelId.includes('chat')
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

export function isOpenAIReasoningModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id, '/')
  return isSupportedReasoningEffortOpenAIModel(model) || modelId.includes('o1')
}

export function isSupportedReasoningEffortOpenAIModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return (
    (modelId.includes('o1') && !(modelId.includes('o1-preview') || modelId.includes('o1-mini'))) ||
    modelId.includes('o3') ||
    modelId.includes('o4') ||
    modelId.includes('gpt-oss') ||
    ((isGPT5SeriesModel(model) || isGPT51SeriesModel(model)) && !modelId.includes('chat'))
  )
}

const OPENAI_DEEP_RESEARCH_MODEL_REGEX = /deep[-_]?research/

export function isOpenAIDeepResearchModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const providerId = model.provider
  if (providerId !== 'openai' && providerId !== 'openai-chat') {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  return OPENAI_DEEP_RESEARCH_MODEL_REGEX.test(modelId)
}
