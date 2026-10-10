import { and, eq } from 'drizzle-orm'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { modelService } from '@data/services/ModelService'
import { mergePresetModel, providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { MODALITY, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { isVisionModel } from '@shared/utils/model'

const logger = loggerService.withContext('claudeCode:modelImageSupport')

function registryVisionForModel(providerId: string, modelId: string): boolean {
  const db = application.get('DbService').getDb()
  const context = providerService.getReasoningContextsByProviderIdsTx(db, [providerId]).get(providerId)
  if (!context) return false

  const { providerModel, presetModel, registryOverride, reasoningProfile, serviceTierControl } =
    providerRegistryService.resolveModel(context, modelId)
  if (providerModel) return isVisionModel(providerModel)
  if (!presetModel) return false

  return isVisionModel(
    mergePresetModel(
      presetModel,
      registryOverride,
      providerId,
      reasoningProfile.wire,
      reasoningProfile.support,
      serviceTierControl
    )
  )
}

function userDisabledVisionInput(providerId: string, modelId: string): boolean {
  const [row] = application
    .get('DbService')
    .getDb()
    .select({
      inputModalities: userModelTable.inputModalities,
      inputModalitiesExplicit: userModelTable.inputModalitiesExplicit
    })
    .from(userModelTable)
    .where(and(eq(userModelTable.providerId, providerId), eq(userModelTable.modelId, modelId)))
    .limit(1)
    .all()

  return Boolean(row?.inputModalitiesExplicit && !row.inputModalities?.includes(MODALITY.IMAGE))
}

/**
 * Whether the agent turn's model should receive native image blocks instead of OCR text.
 * Uses the hydrated model row first, then the live registry catalog when the stored row still
 * reflects an older capability snapshot. Explicit "no image" input modalities always win.
 */
export function resolveModelNativeImageSupport(uniqueModelId: UniqueModelId): boolean {
  try {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    const model = modelService.getByKey(providerId, modelId)
    if (userDisabledVisionInput(providerId, modelId)) return false
    if (isVisionModel(model)) return true
    return registryVisionForModel(providerId, modelId)
  } catch (error) {
    logger.warn('Failed to resolve model for image support; assuming vision-capable', {
      uniqueModelId,
      error
    })
    return true
  }
}
