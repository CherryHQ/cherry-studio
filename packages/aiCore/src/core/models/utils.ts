import type { ImageModelV2, ImageModelV3, LanguageModelV2, LanguageModelV3 } from '@ai-sdk/provider'

import type { AiSdkModel } from '../providers'

export const isV2Model = (model: AiSdkModel): model is LanguageModelV2 => {
  return typeof model === 'object' && model !== null && 'doStream' in model && model.specificationVersion === 'v2'
}

export const isV3Model = (model: AiSdkModel): model is LanguageModelV3 => {
  return typeof model === 'object' && model !== null && 'doStream' in model && model.specificationVersion === 'v3'
}

export const isImageModel = (model: AiSdkModel): model is ImageModelV2 | ImageModelV3 => {
  return (
    typeof model === 'object' &&
    model !== null &&
    'maxImagesPerCall' in model &&
    (model.specificationVersion === 'v2' || model.specificationVersion === 'v3')
  )
}

/**
 * Type guard to check if a model has a modelId property
 */
export const hasModelId = (model: unknown): model is { modelId: string } => {
  if (typeof model !== 'object' || model === null) {
    return false
  }

  if (!('modelId' in model)) {
    return false
  }

  return typeof model.modelId === 'string'
}
