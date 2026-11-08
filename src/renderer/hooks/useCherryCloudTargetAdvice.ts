import { useCallback } from 'react'

import { getCherryCloudTargetAdvice } from '@renderer/utils/cherryCloudTargetAdvice'
import type { UniqueModelId } from '@shared/data/types/model'

import { useCherryCloudModelAvailability } from './useCherryCloudModelAvailability'

export function useCherryCloudTargetAdvice(enabled: boolean) {
  const { availabilityFreshness, scopeId, revision, isModelUnavailable } = useCherryCloudModelAvailability(enabled)
  const getAdvice = useCallback(
    (targetIds: readonly UniqueModelId[] | undefined) =>
      getCherryCloudTargetAdvice(targetIds, { freshness: availabilityFreshness, isModelUnavailable }),
    [availabilityFreshness, isModelUnavailable]
  )
  return { getAdvice, wakeupKey: `${scopeId ?? 'unknown'}:${revision ?? 'unknown'}:${availabilityFreshness}` }
}
