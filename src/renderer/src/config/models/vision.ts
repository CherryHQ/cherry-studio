import { getProviderByModel } from '@renderer/services/AssistantService'
import { Model } from '@renderer/types'
import { getLowerBaseModelName, isUserSelectedModelType } from '@renderer/utils'

import { isEmbeddingModel, isRerankModel } from './embedding'

// Vision models
const visionAllowedModels = [
  'llava',
  'moondream',
  'minicpm',
  'gemini-1\\.5',
  'gemini-2\\.0',
  'gemini-2\\.5',
  'gemini-exp',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'vision',
  'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen2.5-omni',
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
export const VISION_REGEX = new RegExp(
  `\\b(?!(?:${visionExcludedModels.join('|')})\\b)(${visionAllowedModels.join('|')})\\b`,
  'i'
)

// For middleware to identify models that must use the dedicated Image API
export const DEDICATED_IMAGE_MODELS = [
  'grok-2-image',
  'grok-2-image-1212',
  'grok-2-image-latest',
  'dall-e-3',
  'dall-e-2',
  'gpt-image-1'
]

export const IMAGE_ENHANCEMENT_MODELS = [
  'grok-2-image(?:-[\\w-]+)?',
  'qwen-image-edit',
  'gpt-image-1',
  'gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation'
]

const IMAGE_ENHANCEMENT_MODELS_REGEX = new RegExp(IMAGE_ENHANCEMENT_MODELS.join('|'), 'i')

// Models that should auto-enable image generation button when selected
export const AUTO_ENABLE_IMAGE_MODELS = ['gemini-2.5-flash-image-preview', ...DEDICATED_IMAGE_MODELS]

export const OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS = [
  'o3',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5'
]

export const OPENAI_IMAGE_GENERATION_MODELS = [...OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS, 'gpt-image-1']

export const GENERATE_IMAGE_MODELS = [
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-exp-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.5-flash-image-preview',
  ...DEDICATED_IMAGE_MODELS
]

export const isDedicatedImageGenerationModel = (model: Model): boolean => {
  if (!model) return false

  const modelId = getLowerBaseModelName(model.id)
  return DEDICATED_IMAGE_MODELS.some((m) => modelId.includes(m))
}

export const isAutoEnableImageGenerationModel = (model: Model): boolean => {
  if (!model) return false

  const modelId = getLowerBaseModelName(model.id)
  return AUTO_ENABLE_IMAGE_MODELS.some((m) => modelId.includes(m))
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
    return (
      OPENAI_IMAGE_GENERATION_MODELS.some((imageModel) => modelId.includes(imageModel)) ||
      GENERATE_IMAGE_MODELS.some((imageModel) => modelId.includes(imageModel))
    )
  }

  return GENERATE_IMAGE_MODELS.some((imageModel) => modelId.includes(imageModel))
}

/**
 * 判断模型是否支持纯图片生成（不支持通过工具调用）
 * @param model
 * @returns
 */
export function isPureGenerateImageModel(model: Model): boolean {
  if (!isGenerateImageModel(model) || !isTextToImageModel(model)) {
    return false
  }

  const modelId = getLowerBaseModelName(model.id)
  return !OPENAI_TOOL_USE_IMAGE_GENERATION_MODELS.some((imageModel) => modelId.includes(imageModel))
}

// Text to image models
export const TEXT_TO_IMAGE_REGEX = /flux|diffusion|stabilityai|sd-|dall|cogview|janus|midjourney|mj-|image|gpt-image/i

export function isTextToImageModel(model: Model): boolean {
  const modelId = getLowerBaseModelName(model.id)
  return TEXT_TO_IMAGE_REGEX.test(modelId)
}

export function isNotSupportedImageSizeModel(model?: Model): boolean {
  if (!model) {
    return false
  }

  const baseName = getLowerBaseModelName(model.id, '/')

  return baseName.includes('grok-2-image')
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
