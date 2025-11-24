import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model } from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

import { isEmbeddingModel, isRerankModel } from './embedding'
import { isFunctionCallingModel } from './tooluse'

// Vision models
const visionAllowedModels = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-3-(?:flash|pro)(?:-preview)?',
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
  'kimi-latest',
  'gemma-3(?:-[\\w-]+)',
  'doubao-seed-1[.-]6(?:-[\\w-]+)?',
  'kimi-thinking-preview',
  `gemma3(?:[-:\\w]+)?`,
  'kimi-vl-a3b-thinking(?:-[\\w-]+)?',
  'llama-guard-4(?:-[\\w-]+)?',
  'llama-4(?:-[\\w-]+)?',
  'step-1o(?:.*vision)?',
  'step-1v(?:-[\\w-]+)?',
  'qwen-omni(?:-[\\w-]+)?'
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

// For middleware to identify models that must use the dedicated Image API
const DEDICATED_IMAGE_MODELS = [
  'grok-2-image(?:-[\\w-]+)?',
  'dall-e(?:-[\\w-]+)?',
  'gpt-image-1(?:-[\\w-]+)?',
  'imagen(?:-[\\w-]+)?'
]

const IMAGE_ENHANCEMENT_MODELS = [
  'grok-2-image(?:-[\\w-]+)?',
  'qwen-image-edit',
  'gpt-image-1',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?'
]

const IMAGE_ENHANCEMENT_MODELS_REGEX = new RegExp(IMAGE_ENHANCEMENT_MODELS.join('|'), 'i')

const DEDICATED_IMAGE_MODELS_REGEX = new RegExp(DEDICATED_IMAGE_MODELS.join('|'), 'i')

// Models that should auto-enable image generation button when selected
const AUTO_ENABLE_IMAGE_MODELS = [
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?',
  ...DEDICATED_IMAGE_MODELS
]

const AUTO_ENABLE_IMAGE_MODELS_REGEX = new RegExp(AUTO_ENABLE_IMAGE_MODELS.join('|'), 'i')

const OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS = [
  'o3',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5'
]

const OPENAI_IMAGE_GENERATION_MODELS = [...OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS, 'gpt-image-1']

const MODERN_IMAGE_MODELS = ['gemini-3(?:\\.\\d+)?-pro-image(?:-[\\w-]+)?']

const GENERATE_IMAGE_MODELS = [
  'gemini-2.0-flash-exp(?:-[\\w-]+)?',
  'gemini-2.5-flash-image(?:-[\\w-]+)?',
  'gemini-2.0-flash-preview-image-generation',
  ...MODERN_IMAGE_MODELS,
  ...DEDICATED_IMAGE_MODELS
]

const OPENAI_IMAGE_GENERATION_MODELS_REGEX = new RegExp(OPENAI_IMAGE_GENERATION_MODELS.join('|'), 'i')

const GENERATE_IMAGE_MODELS_REGEX = new RegExp(GENERATE_IMAGE_MODELS.join('|'), 'i')

const MODERN_GENERATE_IMAGE_MODELS_REGEX = new RegExp(MODERN_IMAGE_MODELS.join('|'), 'i')

export const isDedicatedImageGenerationModel = (model: Model): boolean => {
  if (!model) return false

  const modelId = getLowerBaseModelName(model.id)
  return DEDICATED_IMAGE_MODELS_REGEX.test(modelId)
}

export const isAutoEnableImageGenerationModel = (model: Model): boolean => {
  if (!model) return false

  const modelId = getLowerBaseModelName(model.id)
  return AUTO_ENABLE_IMAGE_MODELS_REGEX.test(modelId)
}

/**
 * 判断模型是否支持对话式的图片生成
 * @param model
 * @returns
 */
export function isGenerateImageModel(model: Model): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model)) {
    return false
  }

  const provider = getProviderByModel(model)

  if (!provider) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id, '/')

  if (provider.type === 'openai-response') {
    return OPENAI_IMAGE_GENERATION_MODELS_REGEX.test(modelId) || GENERATE_IMAGE_MODELS_REGEX.test(modelId)
  }

  return GENERATE_IMAGE_MODELS_REGEX.test(modelId)
}

// TODO: refine the regex
/**
 * 判断模型是否支持纯图片生成（不支持通过工具调用）
 * @param model
 * @returns
 */
export function isPureGenerateImageModel(model: Model): boolean {
  if (!isGenerateImageModel(model) && !isTextToImageModel(model)) {
    return false
  }

  if (isFunctionCallingModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  if (GENERATE_IMAGE_MODELS_REGEX.test(modelId) && !MODERN_GENERATE_IMAGE_MODELS_REGEX.test(modelId)) {
    return true
  }

  return !OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS.some((m) => modelId.includes(m))
}

// TODO: refine the regex
// Text to image models
const TEXT_TO_IMAGE_REGEX = /flux|diffusion|stabilityai|sd-|dall|cogview|janus|midjourney|mj-|imagen|gpt-image/i

export function isTextToImageModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return TEXT_TO_IMAGE_REGEX.test(modelId)
}

/**
 * 判断模型是否支持图片增强（包括编辑、增强、修复等）
 * @param model
 */
export function isImageEnhancementModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return IMAGE_ENHANCEMENT_MODELS_REGEX.test(modelId)
}

export function isVisionModel(model: Model): boolean {
  if (!model || isEmbeddingModel(model) || isRerankModel(model)) {
    return false
  }
  // 新添字段 copilot-vision-request 后可使用 vision
  // if (model.provider === 'copilot') {
  //   return false
  // }
  if (isUserSelectedModelType(model, 'vision') !== undefined) {
    return isUserSelectedModelType(model, 'vision')!
  }

  const modelId = getLowerBaseModelName(model.id)
  if (model.provider === 'doubao' || modelId.includes('doubao')) {
    return VISION_REGEX.test(model.name) || VISION_REGEX.test(modelId) || false
  }

  return VISION_REGEX.test(modelId) || IMAGE_ENHANCEMENT_MODELS_REGEX.test(modelId) || false
}
