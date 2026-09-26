// Without this, retry only helps people who hand-built a fallback list — so a failing model just
// fails. Any model whose last probe passed is a usable backup, so use them when no list is set.

import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import type { ModelHealthMemory, RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'
import { createUniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { freshModelHealth } from '@shared/utils/modelHealth'
import { getModelQualityScore } from '@shared/utils/modelQuality'

const logger = loggerService.withContext('AutoFallback')

/** Keeps the automatic chain short: each extra entry is another failed request the user waits on. */
const MAX_AUTO_FALLBACKS = 4

/**
 * Builds a fallback chain from models whose last health probe passed, best quality first.
 * Returns `[]` when nothing has been probed yet, so nothing is tried blindly.
 */
export function buildAutoFallbackModelIds(health: ModelHealthMemory): RetryFallbackModelId[] {
  const healthyIds = Object.entries(health)
    .filter(([, entry]) => freshModelHealth(entry)?.ok)
    .map(([uniqueModelId]) => uniqueModelId)
  if (healthyIds.length === 0) return []

  try {
    const chatModels = modelService.list({ enabled: true }).filter((model) => !isNonChatModel(model))
    const healthy = new Set(healthyIds)
    return chatModels
      .map((model) => createUniqueModelId(model.providerId, model.id))
      .filter((uniqueModelId) => healthy.has(uniqueModelId))
      .sort((a, b) => getModelQualityScore(b) - getModelQualityScore(a))
      .slice(0, MAX_AUTO_FALLBACKS) as RetryFallbackModelId[]
  } catch (error) {
    logger.warn('could not build an automatic fallback chain', { error })
    return []
  }
}
