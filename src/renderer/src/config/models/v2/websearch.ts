import { getLowerBaseModelName } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { getCapabilityState } from './shared'
import type { ProviderSettingsEndpointModel } from './types'
import { isPureGenerateImageModel } from './vision'

const CLAUDE_SUPPORTED_WEBSEARCH_REGEX = new RegExp(
  `\\b(?:claude-3(-|\\.)(7|5)-sonnet(?:-[\\w-]+)|claude-3(-|\\.)5-haiku(?:-[\\w-]+)|claude-(haiku|sonnet|opus)-4(?:-[\\w-]+)?)\\b`,
  'i'
)

const GEMINI_SEARCH_REGEX = new RegExp(
  'gemini-(?:2(?!.*-image-preview).*(?:-latest)?|3(?:\\.\\d+)?-(?:flash|pro)(?:-(?:image-)?preview)?|flash-latest|pro-latest|flash-lite-latest)(?:-[\\w-]+)*$',
  'i'
)

const PERPLEXITY_SEARCH_MODELS = ['sonar-pro', 'sonar', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research']
const NEW_API_PROVIDER_IDS = ['new-api', 'cherryin', 'aionly']
type RuntimeEndpointType = NonNullable<Model['endpointTypes']>[number]

function isAnthropicModel(modelId: string): boolean {
  return getLowerBaseModelName(modelId).startsWith('claude')
}

function isClaude4SeriesModel(modelId: string): boolean {
  return /claude-(sonnet|opus|haiku)-4(?:[.-]\d+)?(?:[@\-:][\w\-:]+)?$/i.test(getLowerBaseModelName(modelId, '/'))
}

function hasEndpointType(model: Pick<Model, 'endpointTypes'>, endpointType: RuntimeEndpointType): boolean {
  return model.endpointTypes?.includes(endpointType) ?? false
}

function isOpenAIWebSearchModel(modelId: string): boolean {
  const normalizedModelId = getLowerBaseModelName(modelId)
  return (
    normalizedModelId.includes('gpt-4o-search-preview') ||
    normalizedModelId.includes('gpt-4o-mini-search-preview') ||
    (normalizedModelId.includes('gpt-4.1') && !normalizedModelId.includes('gpt-4.1-nano')) ||
    (normalizedModelId.includes('gpt-4o') && !normalizedModelId.includes('gpt-4o-image')) ||
    normalizedModelId.includes('o3') ||
    normalizedModelId.includes('o4') ||
    (normalizedModelId.includes('gpt-5') && !normalizedModelId.includes('chat'))
  )
}

export function isWebSearchModel(model: ProviderSettingsEndpointModel): boolean {
  if (isEmbeddingModel(model) || isRerankModel(model) || isPureGenerateImageModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'web_search')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  if (isAnthropicModel(model.id) && model.providerId !== 'aws-bedrock') {
    if (model.providerId === 'vertexai') {
      return isClaude4SeriesModel(model.id)
    }
    return CLAUDE_SUPPORTED_WEBSEARCH_REGEX.test(modelId)
  }

  if (hasEndpointType(model, 'openai-responses') || model.providerId === 'azure-openai') {
    if (isOpenAIWebSearchModel(model.id)) {
      return true
    }
    return model.providerId === 'grok'
  }

  if (model.providerId === 'perplexity') {
    return PERPLEXITY_SEARCH_MODELS.includes(modelId)
  }

  if (model.providerId === 'aihubmix') {
    return (!modelId.endsWith('-search') && GEMINI_SEARCH_REGEX.test(modelId)) || isOpenAIWebSearchModel(model.id)
  }

  if (hasEndpointType(model, 'openai-chat-completions') || NEW_API_PROVIDER_IDS.includes(model.providerId)) {
    if (GEMINI_SEARCH_REGEX.test(modelId) || isOpenAIWebSearchModel(model.id)) {
      return true
    }
  }

  if (hasEndpointType(model, 'google-generate-content')) {
    return GEMINI_SEARCH_REGEX.test(modelId)
  }

  if (model.providerId === 'hunyuan') {
    return modelId !== 'hunyuan-lite'
  }

  if (model.providerId === 'zhipu') {
    return false
  }

  if (model.providerId === 'dashscope') {
    return ['qwen-turbo', 'qwen-max', 'qwen-plus', 'qwq', 'qwen-flash', 'qwen3-max'].some((id) =>
      modelId.startsWith(id)
    )
  }

  return model.providerId === 'openrouter'
}
