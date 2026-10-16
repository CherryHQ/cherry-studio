import { useMemo } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import {
  resolveEffectiveUserEffortMap,
  sanitizeUserReasoningEffortMap,
  type UserReasoningEffortMap
} from '@shared/ai/reasoningEffortMappings'
import { isUniqueModelId, type Model, parseUniqueModelId } from '@shared/data/types/model'

/**
 * The user's effective reasoning-effort mapping for one model: owns the
 * `feature.reasoning.effort_mappings` preference read and the global → provider → model scope
 * resolution, sanitized to the efforts the model declares. Empty when there is no model.
 */
export function useUserReasoningEffortMap(model: Model | null | undefined): UserReasoningEffortMap {
  const [effortMappings] = usePreference('feature.reasoning.effort_mappings')
  const providerId = model?.providerId
  const id = model?.id
  const family = model?.family
  const selectableEfforts = model?.reasoning?.selectableEfforts
  return useMemo(() => {
    if (providerId === undefined || id === undefined) return {}
    const raw = resolveEffectiveUserEffortMap(effortMappings, {
      providerId,
      modelId: isUniqueModelId(id) ? parseUniqueModelId(id).modelId : id,
      modelFamily: family,
      uniqueModelId: isUniqueModelId(id) ? id : undefined
    })
    return sanitizeUserReasoningEffortMap(raw, selectableEfforts)
  }, [effortMappings, family, id, providerId, selectableEfforts])
}
