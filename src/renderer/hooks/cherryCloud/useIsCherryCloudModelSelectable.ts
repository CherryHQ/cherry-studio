import { useCallback } from 'react'

import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import type { Model } from '@shared/data/types/model'

/** Cloud availability check for owners that independently validate model, provider and capability eligibility. */
export function useIsCherryCloudModelSelectable({
  includeAgentOnlyModels = false,
  enabled = true
}: { includeAgentOnlyModels?: boolean; enabled?: boolean } = {}): (model: Model) => boolean {
  const { isModelHidden, isModelUnavailable } = useCherryCloudModelAvailability(enabled)
  return useCallback(
    (model: Model) => !isModelHidden(model, includeAgentOnlyModels) && !isModelUnavailable(model),
    [includeAgentOnlyModels, isModelHidden, isModelUnavailable]
  )
}
