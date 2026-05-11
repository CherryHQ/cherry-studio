import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import type { Model } from '@renderer/types'
import type { UniqueModelId } from '@shared/data/types/model'

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
