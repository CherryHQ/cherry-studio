import { dataApiService } from '@data/DataApiService'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'

import type { ModelOption } from '../types/paintingModel'

export function createModelOptionFromModel(model: Model): ModelOption {
  return {
    label: model.name || model.apiModelId || parseUniqueModelId(model.id).modelId,
    value: model.apiModelId || parseUniqueModelId(model.id).modelId,
    group: model.group,
    isEnabled: model.isEnabled,
    raw: model
  }
}

export function supportsImageGenerationEndpoint(model: Model): boolean {
  if (model.endpointTypes?.length) {
    return model.endpointTypes.includes(ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION)
  }

  return model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)
}

export function getPaintingModelOptions(providerId: string, models: Model[]): ModelOption[] {
  return models
    .filter((model) => model.providerId === providerId && !model.isHidden && supportsImageGenerationEndpoint(model))
    .map(createModelOptionFromModel)
}

export async function loadPaintingModelOptions(providerId: string): Promise<ModelOption[]> {
  const models = await dataApiService.get('/models', {
    query: {
      providerId
    }
  })

  return getPaintingModelOptions(providerId, models)
}
