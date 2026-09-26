import { application } from '@application'
import { resolveEffectiveUserEffortMap, sanitizeUserReasoningEffortMap } from '@shared/ai/reasoningEffortMappings'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export function getUserReasoningEffortMap(
  provider: Pick<Provider, 'id'>,
  model: Pick<Model, 'id' | 'family' | 'reasoning'>
) {
  const preferenceService = application.get('PreferenceService')
  const overrides = preferenceService.get('feature.reasoning.effort_mappings')
  const { modelId } = parseUniqueModelId(model.id)
  const raw = resolveEffectiveUserEffortMap(overrides, {
    providerId: provider.id,
    modelId,
    modelFamily: model.family,
    uniqueModelId: model.id
  })
  return sanitizeUserReasoningEffortMap(raw, model.reasoning?.selectableEfforts)
}
