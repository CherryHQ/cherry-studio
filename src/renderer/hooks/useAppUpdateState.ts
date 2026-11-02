import { useCallback, useMemo } from 'react'

import { cacheService } from '@data/CacheService'
import { useCache, useSharedCacheValue } from '@data/hooks/useCache'
import { DefaultSharedCache } from '@shared/data/cache/cacheSchemas'
import type { CacheAppUpdateState } from '@shared/data/cache/cacheValueTypes'

export const useAppUpdateState = () => {
  const [intent, setIntent] = useCache('app.dist.update_state')
  const status = useSharedCacheValue('app.dist.update_status') ?? DefaultSharedCache['app.dist.update_status']
  const appUpdateState = useMemo(() => ({ ...status, ...intent }), [status, intent])

  const updateAppUpdateState = useCallback(
    (state: Partial<CacheAppUpdateState>) => {
      const { manualCheck, ignore, ...statusPatch } = state
      if (statusPatch.checking) statusPatch.lastErrorKey = null
      if (manualCheck !== undefined || ignore !== undefined) {
        setIntent((previous) => ({
          manualCheck: manualCheck ?? previous.manualCheck,
          ignore: ignore ?? previous.ignore
        }))
      }
      if (Object.keys(statusPatch).length > 0) {
        const previous =
          cacheService.getShared('app.dist.update_status') ?? DefaultSharedCache['app.dist.update_status']
        cacheService.setShared('app.dist.update_status', { ...previous, ...statusPatch })
      }
    },
    [setIntent]
  )

  return {
    appUpdateState,
    updateAppUpdateState
  }
}
