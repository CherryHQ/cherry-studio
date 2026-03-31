import type { LanguageModelV2, LanguageModelV3 } from '@ai-sdk/provider'

import type { AiSdkModel } from '../providers'

export const isV2Model = (model: AiSdkModel): model is LanguageModelV2 => {
  return typeof model === 'object' && model !== null && model.specificationVersion === 'v2'
}

export const isV3Model = (model: AiSdkModel): model is LanguageModelV3 => {
  return typeof model === 'object' && model !== null && model.specificationVersion === 'v3'
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

  const obj = model as Record<string, unknown>
  return typeof obj.modelId === 'string'
}
