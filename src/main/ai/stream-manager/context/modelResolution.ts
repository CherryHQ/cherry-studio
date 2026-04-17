/**
 * Shared helpers for resolving models and siblings groups, reused by any
 * `ChatContextProvider` that needs multi-model / regenerate semantics.
 */

import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

/** Resolve the Model list from an optional `@mentioned` list, falling back to the assistant default. */
export async function resolveModels(
  mentionedModelIds: UniqueModelId[] | undefined,
  defaultModelId: UniqueModelId
): Promise<Model[]> {
  if (mentionedModelIds?.length) {
    return Promise.all(
      mentionedModelIds.map(async (uniqueModelId) => {
        const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
        return modelService.getByKey(providerId, modelId)
      })
    )
  }

  const { providerId, modelId } = parseUniqueModelId(defaultModelId)
  return [await modelService.getByKey(providerId, modelId)]
}

/**
 * Compute the siblingsGroupId for this turn.
 *
 * - Multi-model: always a fresh group id so parallel responses are rendered as siblings.
 * - Regenerate: inherit existing sibling group if present, otherwise allocate a new one
 *   and backfill existing children so the new response joins the group.
 * - Single-model fresh turn: undefined (no sibling grouping needed).
 *
 * Persistent-topic only helper; temporary topics have no branching / siblings concept.
 */
export async function resolvePersistentSiblingsGroupId(
  models: Model[],
  isRegenerate: boolean,
  userMessageId: string
): Promise<number | undefined> {
  if (models.length > 1) return Date.now()
  if (!isRegenerate) return undefined

  const children = await messageService.getChildrenByParentId(userMessageId)
  const existingGroup = children.find((m) => m.siblingsGroupId > 0)?.siblingsGroupId
  const groupId = existingGroup ?? Date.now()
  for (const child of children) {
    if (child.siblingsGroupId === 0) {
      await messageService.updateSiblingsGroupId(child.id, groupId)
    }
  }
  return groupId
}
