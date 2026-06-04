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

/**
 * A model is a painting-page candidate when it claims the `image-generation`
 * capability OR exposes one of the OpenAI image endpoints. The two checks are
 * OR'd — declaring an unrelated endpoint (`openai-chat-completions`) on a
 * model that ALSO sets `image-generation` capability must not exclude it.
 */
export function supportsImageGenerationEndpoint(model: Model): boolean {
  if (model.capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION)) {
    return true
  }
  return (
    model.endpointTypes?.some(
      (e) => e === ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION || e === ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
    ) ?? false
  )
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
