import { cacheService } from '@data/CacheService'
import { type TabSessionHandle, tabSessionRegistry } from '@renderer/services/TabSessionRegistry'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'
import { useMemo } from 'react'

function sessionCacheKeys(tabSession: string): UseCacheKey[] {
  return [
    `translate.input.${tabSession}`,
    `translate.output.${tabSession}`,
    `translate.stream_text.${tabSession}`,
    `translate.detecting.${tabSession}`
  ]
}

/**
 * The session that owns this translate page's draft and its in-flight run.
 *
 * The handle outlives the component: hibernating the tab or switching away from it unmounts the
 * page, and the run has to keep going (#18885). Only the tab dropping the id from its url ends
 * the session, at which point the registry aborts the run and this release drops the draft.
 */
export function useTranslateSession(tabSession: string): TabSessionHandle {
  return useMemo(
    () =>
      tabSessionRegistry.getOrCreate(tabSession, () => {
        // Delete every key before reporting: a refusal on one (its hook is still mounted) must
        // not skip the rest, and the sweep retries the whole set anyway.
        let released = true
        for (const key of sessionCacheKeys(tabSession)) {
          if (!cacheService.delete(key)) released = false
        }
        return released
      }),
    [tabSession]
  )
}
