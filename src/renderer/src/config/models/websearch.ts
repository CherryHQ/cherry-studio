import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

import type { ClassifiableModel } from './classifiable'
import { getModelProviderId, modelHasEndpointType } from './classifiable'

export { GEMINI_FLASH_MODEL_REGEX } from './utils'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { isClaude4SeriesModel } from './reasoning'
import { isAnthropicModel } from './utils'
import { isTextToImageModel } from './vision'

const CLAUDE_SUPPORTED_WEBSEARCH_REGEX = new RegExp(
  `\\b(?:claude-3(-|\\.)(7|5)-sonnet(?:-[\\w-]+)|claude-3(-|\\.)5-haiku(?:-[\\w-]+)|claude-(haiku|sonnet|opus)-4(?:-[\\w-]+)?)\\b`,
  'i'
)

export const GEMINI_SEARCH_REGEX = new RegExp(
  'gemini-(?:2(?!.*-image-preview).*(?:-latest)?|3(?:\\.\\d+)?-(?:flash|pro)(?:-(?:image-)?preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\\w-]+)*$',
  'i'
)

export const PERPLEXITY_SEARCH_MODELS = [
  'sonar-pro',
  'sonar',
  'sonar-reasoning',
  'sonar-reasoning-pro',
  'sonar-deep-research'
]

const NEW_API_PROVIDER_IDS = ['new-api', 'cherryin', 'aionly']

export function isWebSearchModel(model: ClassifiableModel): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model) || isTextToImageModel(model)) {
    return false
  }

  if (isUserSelectedModelType(model, 'web_search') !== undefined) {
    return isUserSelectedModelType(model, 'web_search')!
  }

  const pid = getModelProviderId(model)
  if (!pid) return false

  const modelId = getLowerBaseModelName(model.id, '/')

  // Anthropic models: bedrock 不支持, vertex 只支持 claude-4 系列, 其他走 regex
  if (isAnthropicModel(model) && pid !== 'aws-bedrock') {
    if (pid === 'vertexai') {
      return isClaude4SeriesModel(model)
    }
    return CLAUDE_SUPPORTED_WEBSEARCH_REGEX.test(modelId)
  }

  // OpenAI Responses / Azure: 支持 OpenAI web search 模型 + grok
  if (modelHasEndpointType(model, 'openai-responses') || pid === 'azure-openai') {
    if (isOpenAIWebSearchModel(model)) {
      return true
    }
    if (pid === 'grok') {
      return true
    }
    return false
  }

  if (pid === 'perplexity') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  if (pid === 'aihubmix') {
    if (!modelId.endsWith('-search') && GEMINI_SEARCH_REGEX.test(modelId)) {
      return true
    }
    if (isOpenAIWebSearchModel(model)) {
      return true
    }
    return false
  }

  // OpenAI-compatible / new-api providers
  if (modelHasEndpointType(model, 'openai-chat-completions') || NEW_API_PROVIDER_IDS.includes(pid)) {
    if (GEMINI_SEARCH_REGEX.test(modelId) || isOpenAIWebSearchModel(model)) {
      return true
    }
  }

  // Gemini / Vertex
  if (modelHasEndpointType(model, 'google-generate-content')) {
    return GEMINI_SEARCH_REGEX.test(modelId)
  }

  if (pid === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  if (pid === 'zhipu') {
    return false
  }

  if (pid === 'dashscope') {
    const models = ['qwen-turbo', 'qwen-max', 'qwen-plus', 'qwq', 'qwen-flash', 'qwen3-max']
    return models.some((i) => modelId.startsWith(i))
  }

  if (pid === 'openrouter') {
    return true
  }

  return false
}

export function isMandatoryWebSearchModel(model: ClassifiableModel): boolean {
  if (!model) {
    return false
  }

  const pid = getModelProviderId(model)
  const modelId = getLowerBaseModelName(model.id)

  if (pid === 'perplexity' || pid === 'openrouter') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  return false
}

export function isOpenRouterBuiltInWebSearchModel(model: ClassifiableModel): boolean {
  if (!model) {
    return false
  }

  if (getModelProviderId(model) !== 'openrouter') {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  return isOpenAIWebSearchChatCompletionOnlyModel(model) || modelId.includes('sonar')
}

export function isOpenAIWebSearchChatCompletionOnlyModel(model: ClassifiableModel): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return modelId.includes('gpt-4o-search-preview') || modelId.includes('gpt-4o-mini-search-preview')
}

export function isOpenAIWebSearchModel(model: ClassifiableModel): boolean {
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

export function isHunyuanSearchModel(model?: ClassifiableModel): boolean {
  if (!model) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)

  if (getModelProviderId(model) === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  return false
}
