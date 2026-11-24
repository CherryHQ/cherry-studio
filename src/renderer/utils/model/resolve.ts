import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { type Model, UniqueModelIdSchema } from '@shared/data/types/model'

async function readPreferredModel(id: string | null): Promise<Model | undefined> {
  const result = UniqueModelIdSchema.safeParse(id)

  if (!result.success) return undefined

  return (await dataApiService.get(`/models/${result.data}`)) ?? undefined
}

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
  return readPreferredModel(await preferenceService.get('chat.default_model_id'))
}

export async function readQuickModel(): Promise<Model | undefined> {
  const id =
    (await preferenceService.get('feature.quick_assistant.model_id')) ??
    (await preferenceService.get('chat.default_model_id'))

  return readPreferredModel(id)
}

export async function readTranslateModel(): Promise<Model | undefined> {
  const id =
    (await preferenceService.get('feature.translate.model_id')) ??
    (await preferenceService.get('chat.default_model_id'))

  return readPreferredModel(id)
}
