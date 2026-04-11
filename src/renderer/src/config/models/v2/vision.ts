import { getLowerBaseModelName } from '@renderer/utils'
import type { Model } from '@shared/data/types/model'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { getCapabilityState } from './shared'
import type { ProviderSettingsCapabilityModel } from './types'

const visionAllowedModels = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-3(?:\\.\\d)?-(?:flash|pro)(?:-preview)?',
  'gemini-(flash|pro|flash-lite)-latest',
  'gemini-exp',
  'claude-3',
  'claude-haiku-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3\\.[5-9](?:-[\\w-]+)?',
  'qwen2.5-omni',
  'qwen3-omni(?:-[\\w-]+)?',
  'qvq',
  'internvl2',
  'grok-vision-beta',
  'grok-4(?:-[\\w-]+)?',
  'pixtral',
  'gpt-4(?:-[\\w-]+)',
  'gpt-4.1(?:-[\\w-]+)?',
  'gpt-4o(?:-[\\w-]+)?',
  'gpt-4.5(?:-[\\w-]+)',
  'gpt-5(?:-[\\w-]+)?',
  'chatgpt-4o(?:-[\\w-]+)?',
  'o1(?:-[\\w-]+)?',
  'o3(?:-[\\w-]+)?',
  'o4(?:-[\\w-]+)?',
  'deepseek-vl(?:[\\w-]+)?',
  'kimi-k2.5',
  'kimi-latest',
  'gemma-?[3-4](?:[-.\\w]+)?',
  'doubao-seed-1[.-][68](?:-[\\w-]+)?',
  'doubao-seed-2[.-]0(?:-[\\w-]+)?',
  'doubao-seed-code(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  'gemma3(?:[-:\\w]+)?',
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?',
  'qwen-omni(?:-[\\w-]+)?',
  'mistral-large-(2512|latest)',
  'mistral-medium-(2508|latest)',
  'mistral-small-(2506|latest)',
  'mimo-v2-omni(?:-[\\w-]+)?',
  'glm-5v-turbo'
]

const visionExcludedModels = [
  'gpt-4-\\d+-preview',
  'gpt-4-turbo-preview',
  'gpt-4-32k',
  'gpt-4-\\d+',
  'o1-mini',
  'o3-mini',
  'o1-preview',
  'AIDC-AI/Marco-o1'
]

const VISION_REGEX = new RegExp(
  `\\b(?!(?:${visionExcludedModels.join('|')})\\b)(${visionAllowedModels.join('|')})\\b`,
  'i'
)

const DEDICATED_IMAGE_MODELS = [
  'dall-e(?:-[\\w-]+)?',
  'gpt-image(?:-[\\w-]+)?',
  'grok-2-image(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?',
  'flux(?:-[\\w-]+)?',
  'stable-?diffusion(?:-[\\w-]+)?',
  'stabilityai(?:-[\\w-]+)?',
  'sd-[\\w-]+',
  'sdxl(?:-[\\w-]+)?',
  'cogview(?:-[\\w-]+)?',
  'qwen-image(?:-[\\w-]+)?',
  'janus(?:-[\\w-]+)?',
  'midjourney(?:-[\\w-]+)?',
  'mj-[\\w-]+',
  'z-image(?:-[\\w-]+)?',
  'longcat-image(?:-[\\w-]+)?',
  'hunyuanimage(?:-[\\w-]+)?',
  'seedream(?:-[\\w-]+)?',
  'kandinsky(?:-[\\w-]+)?'
]

const IMAGE_ENHANCEMENT_MODELS = [
  'grok-2-image(?:-[\\w-]+)?',
  'qwen-image-edit',
  'gpt-image-1',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?'
]

const OPENAI_IMAGE_GENERATION_MODELS = [
  'o3',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5',
  'gpt-image-1'
]
const GENERATE_IMAGE_MODELS = [
  'gemini-2.0-flash-exp(?:-[\\w-]+)?',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?',
  ...DEDICATED_IMAGE_MODELS
]

const OPENAI_IMAGE_GENERATION_MODELS_REGEX = new RegExp(OPENAI_IMAGE_GENERATION_MODELS.join('|'), 'i')
const GENERATE_IMAGE_MODELS_REGEX = new RegExp(GENERATE_IMAGE_MODELS.join('|'), 'i')
const MODERN_GENERATE_IMAGE_MODELS_REGEX = new RegExp(['gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?'].join('|'), 'i')
const DEDICATED_IMAGE_MODEL_REGEX = new RegExp(DEDICATED_IMAGE_MODELS.join('|'), 'i')
const IMAGE_ENHANCEMENT_MODELS_REGEX = new RegExp(IMAGE_ENHANCEMENT_MODELS.join('|'), 'i')
const OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS = [
  'o3',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5'
]

function isTextToImageModel(model: Pick<Model, 'id'>): boolean {
  return DEDICATED_IMAGE_MODEL_REGEX.test(getLowerBaseModelName(model.id))
}

export function isVisionModel(model: ProviderSettingsCapabilityModel): boolean {
  if (isEmbeddingModel(model) || isRerankModel(model)) {
    return false
  }

  const capabilityState = getCapabilityState(model, 'vision')
  if (capabilityState !== undefined) {
    return capabilityState
  }

  const modelId = getLowerBaseModelName(model.id)
  if (model.providerId === 'doubao' || modelId.includes('doubao')) {
    return VISION_REGEX.test(model.name) || VISION_REGEX.test(modelId)
  }

  return VISION_REGEX.test(modelId) || IMAGE_ENHANCEMENT_MODELS_REGEX.test(modelId)
}

export function isGenerateImageModel(model: ProviderSettingsCapabilityModel & Pick<Model, 'endpointTypes'>): boolean {
  if (isEmbeddingModel(model) || isRerankModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')
  if (model.endpointTypes?.includes('openai-responses')) {
    return OPENAI_IMAGE_GENERATION_MODELS_REGEX.test(modelId) || GENERATE_IMAGE_MODELS_REGEX.test(modelId)
  }

  return GENERATE_IMAGE_MODELS_REGEX.test(modelId)
}

export function isPureGenerateImageModel(
  model: ProviderSettingsCapabilityModel & Pick<Model, 'endpointTypes'>
): boolean {
  if (!isGenerateImageModel(model) && !isTextToImageModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  if (GENERATE_IMAGE_MODELS_REGEX.test(modelId) && !MODERN_GENERATE_IMAGE_MODELS_REGEX.test(modelId)) {
    return true
  }

  return !OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS.some((value) => modelId.includes(value))
}
