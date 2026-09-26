import { application } from '@application'
import { resolveEffectiveUserEffortMap, sanitizeUserReasoningEffortMap } from '@shared/ai/reasoningEffortMappings'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export function getUserReasoningEffortMap(
  provider: Pick<Provider, 'id'>,
  model: Pick<Model, 'id' | 'family' | 'reasoning'>
) {
  const preferenceService = application.get('PreferenceService')
  const overrides = preferenceService.get('feature.reasoning.effort_mappings')
  const modelId = isUniqueModelId(model.id) ? parseUniqueModelId(model.id).modelId : model.id
  const raw = resolveEffectiveUserEffortMap(overrides, {
    providerId: provider.id,
    modelId,
    modelFamily: model.family,
    uniqueModelId: isUniqueModelId(model.id) ? model.id : undefined
  })
  return sanitizeUserReasoningEffortMap(raw, model.reasoning?.selectableEfforts)
}
