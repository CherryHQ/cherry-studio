import { useCallback } from 'react'

import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import type { Model } from '@shared/data/types/model'

/** Whether the selector would offer `model` as a selectable row, for owners that preselect a value. */
export function useIsModelSelectable({
  includeAgentOnlyModels = false,
  enabled = true
}: { includeAgentOnlyModels?: boolean; enabled?: boolean } = {}): (model: Model) => boolean {
  const { isModelHidden, isModelUnavailable } = useCherryCloudModelAvailability(enabled)
  return useCallback(
    (model: Model) => !isModelHidden(model, includeAgentOnlyModels) && !isModelUnavailable(model),
    [includeAgentOnlyModels, isModelHidden, isModelUnavailable]
  )
}
