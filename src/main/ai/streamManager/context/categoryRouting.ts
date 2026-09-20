// Sends each request to the model configured as best at its kind of work. An explicit pick always
// wins — this only replaces the default, and only when routing can name a model that still answers.

import { application } from '@application'
import { loggerService } from '@logger'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { TaskCategory } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { freshModelHealth } from '@shared/utils/modelHealth'
import { bestHealthyModelId, pickCategoryModel } from '@shared/utils/routingDecision'
import { classifyTaskCategory, estimateTaskDifficulty } from '@shared/utils/taskCategory'

const logger = loggerService.withContext('CategoryRouting')

type TextPart = { type: string; text?: string }

function promptTextOf(parts: readonly TextPart[]): string {
  return parts
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join(' ')
}

/**
 * Models to consider for a category: the user's own pinned picks first, then the ranking derived
 * from what is installed and working. A pinned model whose provider is currently off is skipped
 * here but deliberately left in preferences, so switching that provider back on restores the pick.
 */
function candidatesFor(category: TaskCategory): UniqueModelId[] {
  const manual = application.get('PreferenceService').get('chat.routing.category_models')[category] ?? []
  const derived = application.get('ModelRoutingService').candidatesFor(category)

  return [...new Set([...manual, ...derived])].filter(
    (id): id is UniqueModelId => isUniqueModelId(id) && modelExists(id)
  )
}

/** A model is only usable if it still exists *and* its provider is switched on. */
function modelExists(uniqueModelId: UniqueModelId): boolean {
  try {
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    modelService.getByKey(providerId, modelId)
    return providerService.getByProviderId(providerId).isEnabled
  } catch {
    return false
  }
}

/**
 * Picks the configured model for the request's detected category, preferring one whose last health
 * probe passed. Returns `fallback` when routing is off, unconfigured, or every candidate is gone.
 */
export function routeDefaultModelId(parts: readonly TextPart[], fallback: UniqueModelId): UniqueModelId {
  const preferences = application.get('PreferenceService')

  // A pinned model overrides category routing but not an explicit @-mention (which replaces `fallback`
  // before this function is ever called).
  const pinnedModel = preferences.get('chat.routing.pinned_model')
  if (pinnedModel && isUniqueModelId(pinnedModel) && modelExists(pinnedModel)) return pinnedModel

  if (!preferences.get('chat.routing.auto_enabled')) return fallback

  try {
    const promptText = promptTextOf(parts)
    const category = classifyTaskCategory(promptText)
    const health = preferences.get('chat.retry.model_health')
    const candidates = candidatesFor(category)

    // Nothing mapped for this category: rather than do nothing, rescue a default that is known
    // broken. A default that still answers (or was never probed) is left alone.
    // A default left over from onboarding can point at a provider the user has since switched off;
    // treat that as broken too, otherwise every chat fails with "model may not exist".
    if (candidates.length === 0) {
      if (freshModelHealth(health[fallback])?.ok !== false && modelExists(fallback)) return fallback
      const rescue = bestHealthyModelId(health, modelExists)
      if (rescue) logger.info('replaced a model that failed its last probe', { category, rescue })
      return rescue ?? fallback
    }

    const difficulty = estimateTaskDifficulty(promptText)
    const chosen = pickCategoryModel(candidates, health, difficulty)
    logger.info('routed request by category', { category, difficulty, chosen })
    return chosen
  } catch (error) {
    // Routing is an optimisation; a bad config must not stop the message from being sent.
    logger.warn('category routing failed, using the default model', { error })
    return fallback
  }
}
