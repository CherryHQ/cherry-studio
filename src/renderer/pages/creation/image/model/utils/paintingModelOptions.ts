import { dataApiService } from '@data/DataApiService'
import { ENDPOINT_TYPE, MODALITY, type Model, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'

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

/**
 * A model is a painting-page candidate when it claims the `image-generation`
 * capability OR exposes one of the OpenAI image endpoints. Capability-only
 * models are rejected when they explicitly declare non-image output modalities.
 */
function canOutputImage(model: Model): boolean {
  return !model.outputModalities?.length || model.outputModalities.includes(MODALITY.IMAGE)
}

export function supportsImageGenerationEndpoint(model: Model): boolean {
  const hasImageEndpoint =
    model.endpointTypes?.some(
      (e) => e === ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION || e === ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
    ) ?? false

  return hasImageEndpoint || (model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION) && canOutputImage(model))
}

export function getPaintingModelOptions(providerId: string, models: readonly Model[]): ModelOption[] {
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
