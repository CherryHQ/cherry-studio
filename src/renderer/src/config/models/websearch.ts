import { getProviderByModel } from '@renderer/services/AssistantService'
import { Model } from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { isAnthropicModel } from './utils'
import { isPureGenerateImageModel, isTextToImageModel } from './vision'

export const CLAUDE_SUPPORTED_WEBSEARCH_REGEX = new RegExp(
  `\\b(?:claude-3(-|\\.)(7|5)-sonnet(?:-[\\w-]+)|claude-3(-|\\.)5-haiku(?:-[\\w-]+)|claude-sonnet-4(?:-[\\w-]+)?|claude-opus-4(?:-[\\w-]+)?)\\b`,
  'i'
)

export const GEMINI_FLASH_MODEL_REGEX = new RegExp('gemini-.*-flash.*$')

export const GEMINI_SEARCH_REGEX = new RegExp('gemini-2\\..*', 'i')

export const PERPLEXITY_SEARCH_MODELS = [
  'sonar-pro',
  'sonar',
  'sonar-reasoning',
  'sonar-reasoning-pro',
  'sonar-deep-research'
]

export function isWebSearchModel(model: Model): boolean {
  if (
    !model ||
    isEmbeddingModel(model) ||
    isRerankModel(model) ||
    isTextToImageModel(model) ||
    isPureGenerateImageModel(model)
  ) {
    return false
  }

  if (isUserSelectedModelType(model, 'web_search') !== undefined) {
    return isUserSelectedModelType(model, 'web_search')!
  }

  const provider = getProviderByModel(model)

  if (!provider) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  // 不管哪个供应商都判断了
  if (isAnthropicModel(model)) {
    return CLAUDE_SUPPORTED_WEBSEARCH_REGEX.test(modelId)
  }

  if (provider.type === 'openai-response') {
    if (isOpenAIWebSearchModel(model)) {
      return true
    }

    return false
  }

  if (provider.id === 'perplexity') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  if (provider.id === 'aihubmix') {
    // modelId 不以-search结尾
    if (!modelId.endsWith('-search') && GEMINI_SEARCH_REGEX.test(modelId)) {
      return true
    }

    if (isOpenAIWebSearchModel(model)) {
      return true
    }

    return false
  }

  if (provider?.type === 'openai') {
    if (GEMINI_SEARCH_REGEX.test(modelId) || isOpenAIWebSearchModel(model)) {
      return true
    }
  }

  if (provider.id === 'gemini' || provider?.type === 'gemini' || provider.type === 'vertexai') {
    return GEMINI_SEARCH_REGEX.test(modelId)
  }

  if (provider.id === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  if (provider.id === 'zhipu') {
    return modelId?.startsWith('glm-4-')
  }

  if (provider.id === 'dashscope') {
    const models = ['qwen-turbo', 'qwen-max', 'qwen-plus', 'qwq', 'qwen-flash', 'qwen3-max']
    // matches id like qwen-max-0919, qwen-max-latest
    return models.some((i) => modelId.startsWith(i))
  }

  if (provider.id === 'openrouter') {
    return true
  }

  if (provider.id === 'grok') {
    return true
  }

  return false
}

export function isMandatoryWebSearchModel(model: Model): boolean {
  if (!model) {
    return false
  }

  const provider = getProviderByModel(model)

  if (!provider) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (provider.id === 'perplexity' || provider.id === 'openrouter') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  return false
}

export function isOpenRouterBuiltInWebSearchModel(model: Model): boolean {
  if (!model) {
    return false
  }

  const provider = getProviderByModel(model)

  if (provider.id !== 'openrouter') {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  return isOpenAIWebSearchChatCompletionOnlyModel(model) || modelId.includes('sonar')
}

export function isOpenAIWebSearchChatCompletionOnlyModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-4o-search-preview') || modelId.includes('gpt-4o-mini-search-preview')
}

export function isOpenAIWebSearchModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)

  return (
    modelId.includes('gpt-4o-search-preview') ||
    modelId.includes('gpt-4o-mini-search-preview') ||
    (modelId.includes('gpt-4.1') && !modelId.includes('gpt-4.1-nano')) ||
    (modelId.includes('gpt-4o') && !modelId.includes('gpt-4o-image')) ||
    modelId.includes('o3') ||
    modelId.includes('o4') ||
    (modelId.includes('gpt-5') && !modelId.includes('chat'))
  )
}

export function isHunyuanSearchModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (model.provider === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  return false
}
