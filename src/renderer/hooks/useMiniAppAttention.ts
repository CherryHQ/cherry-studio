import { cacheService } from '@data/CacheService'
import { useSharedCacheSelector, useSharedCacheValue } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { CacheMiniAppAttention } from '@shared/data/cache/cacheValueTypes'
import { isEqual } from 'es-toolkit/compat'
import { useEffect, useRef } from 'react'

const logger = loggerService.withContext('useMiniAppAttention')

/** Module-level, per the `useSharedCacheValue` contract: an inline `[]` is a new identity each render. */
const NO_ATTENTION: CacheMiniAppAttention[] = []

/**
 * Read-only. The single writer is `useWindowRuntime`; every list item and detail
 * entry reads. Shared tier because the set is identical in every window — a per-window
 * copy would let two windows disagree about which app has a dot.
 */
export function useMiniAppAttention(): CacheMiniAppAttention[] {
  return useSharedCacheValue('mini_app.attention') ?? NO_ATTENTION
}

/** This app's dot and its reasons, or `undefined` when it has none. */
export function useMiniAppAttentionFor(appId: string): CacheMiniAppAttention | undefined {
  return useSharedCacheSelector(
    ['mini_app.attention'],
    ([attention]) => (attention ?? NO_ATTENTION).find((entry) => entry.appId === appId),
    isEqual
  )
}

export function useMiniAppAttentionSync(): void {
  // SUBSCRIBE FIRST, or a grant landing before the subscription is never heard. And a
  // LATE PULL MUST NOT WIN — `pushed` lets it fill only an empty seat.
  const pushed = useRef(false)

  useIpcOn('mini_app.runtime.attention', ({ apps }) => {
    pushed.current = true
    cacheService.setShared('mini_app.attention', apps)
  })

  useEffect(() => {
    void ipcApi
      .request('mini_app.runtime.attention_state')
      .then((apps) => {
        if (pushed.current) return
        cacheService.setShared('mini_app.attention', apps)
      })
      .catch((e) => logger.warn('failed to load mini app attention state', e))
  }, [])
}
