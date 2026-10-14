import { useCallback } from 'react'

import { useCache } from '@data/hooks/useCache'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'

export const useAppUpdateState = () => {
  const [appUpdateState, setAppUpdateState] = useCache('app.dist.update_state')

  const updateAppUpdateState = useCallback(
    (state: Partial<CacheAppUpdateState>) => {
      setAppUpdateState((previous) => ({ ...previous, ...state }))
    },
    [setAppUpdateState]
  )

  return {
    appUpdateState,
    updateAppUpdateState
  }
}
