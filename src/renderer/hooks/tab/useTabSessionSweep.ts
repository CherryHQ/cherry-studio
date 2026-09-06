import { collectLiveSessionIds, tabSessionRegistry } from '@renderer/services/TabSessionRegistry'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { useEffect } from 'react'

/** Grace period between marking a session unreachable and dropping its cached state. */
const RELEASE_DELAY_MS = 1000

/**
 * Release tab sessions no longer reachable from any open tab.
 *
 * Reachability is the entire lifetime rule, so this replaces per-removal-path notifications:
 * closing a tab, detaching it and navigating it elsewhere all end the same way — the session id
 * stops appearing in a tab url — and no removal site has to remember to report anything.
 *
 * The sweep runs at once (an unreachable session's run has no audience), the release does not: a
 * tab's url stops referencing its session before the page rendering it unmounts, and the cache
 * refuses to drop a key a mounted `useCache` still reads (#20074). Nothing about dropping a few
 * memory-cache entries is urgent, so it waits for the unmount instead of racing it.
 */
export function useTabSessionSweep(tabs: readonly Tab[]): void {
  useEffect(() => {
    tabSessionRegistry.sweep(collectLiveSessionIds(tabs))
    const timer = setTimeout(() => tabSessionRegistry.releaseUnreachable(), RELEASE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [tabs])
}
