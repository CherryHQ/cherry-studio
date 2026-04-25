import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { getStoreProviders } from '@renderer/hooks/useStore'
import type { Model } from '@renderer/types'
import type { UniqueModelId } from '@shared/data/types/model'
import { pick } from 'lodash'

import { getProviderName } from './ProviderService'

/**
 * Async resolver for the user's chosen default model.
 *
 * Composition is split across two stores:
 *   - id lives in Preference (`chat.default_model_id`)
 *   - shape lives in DataApi (`/models/:uniqueId`)
 *
 * For React contexts use the {@link useDefaultModel} hook; this exists for
 * non-React callers (services, utils) that need a one-shot read.
 */
export async function readDefaultModel(): Promise<Model | undefined> {
  const id = (await preferenceService.get('chat.default_model_id')) as UniqueModelId | undefined
  if (!id) return undefined
  const apiModel = await dataApiService.get(`/models/${id}`)
  return apiModel ? fromSharedModel(apiModel) : undefined
}

export async function readQuickModel(): Promise<Model | undefined> {
  const id = ((await preferenceService.get('feature.quick_assistant.model_id')) ??
    (await preferenceService.get('chat.default_model_id'))) as UniqueModelId | undefined
  if (!id) return undefined
  const apiModel = await dataApiService.get(`/models/${id}`)
  return apiModel ? fromSharedModel(apiModel) : undefined
}

export async function readTranslateModel(): Promise<Model | undefined> {
  const id = ((await preferenceService.get('feature.translate.model_id')) ??
    (await preferenceService.get('chat.default_model_id'))) as UniqueModelId | undefined
  if (!id) return undefined
  const apiModel = await dataApiService.get(`/models/${id}`)
  return apiModel ? fromSharedModel(apiModel) : undefined
}

export const getModelUniqId = (m?: Model) => {
  return m?.id ? JSON.stringify(pick(m, ['id', 'provider'])) : ''
}

/**
 * Renders a "ModelName | ProviderName" label. Reads the v1 Redux LLM slice
 * for provider lookup and expects a v1-shape `Model` (with `provider`).
 * Used by message-display paths where the model snapshot is persisted in v1
 * shape on each message; will move to a v2 reader once the LLM slice migrates.
 */
export function getModelName(model?: Model) {
  const modelName = model?.name || model?.id || ''
  const provider = getStoreProviders().find((p) => p.id === model?.provider)

  if (provider) {
    const providerName = getProviderName(model as Model)
    return `${modelName} | ${providerName}`
  }

  return modelName
}
