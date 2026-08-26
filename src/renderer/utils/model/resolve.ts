import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'

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
  return (await dataApiService.get(`/models/${id}`)) ?? undefined
}

export async function readQuickModel(): Promise<Model | undefined> {
  const id = ((await preferenceService.get('feature.quick_assistant.model_id')) ??
    (await preferenceService.get('chat.default_model_id'))) as UniqueModelId | undefined
  if (!id) return undefined
  return (await dataApiService.get(`/models/${id}`)) ?? undefined
}

export async function readConversationSuggestionsModel(): Promise<Model | undefined> {
  const dedicatedId = (await preferenceService.get('chat.suggestions.model_id')) as UniqueModelId | null | undefined
  if (dedicatedId) {
    try {
      const dedicated = await dataApiService.get(`/models/${dedicatedId}`)
      if (dedicated && !isNonChatModel(dedicated)) return dedicated
    } catch {
      // Deleted or unreadable dedicated ids must not fail generation.
    }
  }
  const fallback = await readDefaultModel()
  if (fallback && !isNonChatModel(fallback)) return fallback
  return undefined
}

export async function readTranslateModel(): Promise<Model | undefined> {
  const id = ((await preferenceService.get('feature.translate.model_id')) ??
    (await preferenceService.get('chat.default_model_id'))) as UniqueModelId | undefined
  if (!id) return undefined
  return (await dataApiService.get(`/models/${id}`)) ?? undefined
}
