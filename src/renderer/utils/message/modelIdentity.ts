import type { ModelSnapshot } from '@shared/data/types/message'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

export function resolveUniqueModelId(
  modelId: string | null | undefined,
  modelSnapshot: Pick<ModelSnapshot, 'id' | 'provider'> | null | undefined
): UniqueModelId | undefined {
  if (isUniqueModelId(modelId)) return modelId
  if (!modelSnapshot) return undefined

  return createUniqueModelId(modelSnapshot.provider, modelSnapshot.id)
}
