import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('AiModelResolution')

// Sub-ms tiebreaker for back-to-back regenerate clicks. Resets per process; only needs to be session-unique.
let siblingsGroupCounter = 0
function nextSiblingsGroupId(): number {
  siblingsGroupCounter = (siblingsGroupCounter + 1) % 1000
  return Date.now() * 1000 + siblingsGroupCounter
}

/** Resolve the Model list from an optional selector-selected list, falling back to the assistant default. */
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
 * Assistant model when a live persisted assistant id is given; otherwise use
 * `chat.default_model_id`. Missing/deleted assistant ids are treated the same
 * as assistant-less topics for this send only; topic rows are not rewritten.
 */
export async function resolveAssistantModelId(
  assistantId: string | null | undefined
): Promise<{ assistantId: string | undefined; defaultModelId: UniqueModelId }> {
  if (assistantId) {
    try {
      const assistant = await assistantDataService.getById(assistantId)
      if (!assistant.modelId) throw new Error(`Assistant ${assistantId} has no model configured`)
      return { assistantId, defaultModelId: assistant.modelId }
    } catch (error) {
      if (!(error instanceof DataApiError) || error.code !== ErrorCode.NOT_FOUND) throw error
      logger.warn('Assistant missing during model resolution, falling back to default model', { assistantId })
    }
  }

  const defaultModelId = application.get('PreferenceService').get('chat.default_model_id') as UniqueModelId | null
  if (!defaultModelId) throw new Error('No default model configured for assistant fallback')
  return { assistantId: undefined, defaultModelId }
}

/**
 * Pure read. Multi-model → fresh group; regenerate → inherit or
 * allocate; single-model fresh → undefined. Backfill of existing
 * children happens atomically in
 * `messageService.createUserMessageWithPlaceholders`.
 */
export async function resolvePersistentSiblingsGroupId(
  models: Model[],
  isRegenerate: boolean,
  userMessageId: string
): Promise<number | undefined> {
  if (models.length > 1) return nextSiblingsGroupId()
  if (!isRegenerate) return undefined

  const children = await messageService.getChildrenByParentId(userMessageId)
  const existingGroup = children.find((m) => m.siblingsGroupId > 0)?.siblingsGroupId
  return existingGroup ?? nextSiblingsGroupId()
}
