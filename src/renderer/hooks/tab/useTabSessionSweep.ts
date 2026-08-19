import { collectLiveSessionIds, tabSessionRegistry } from '@renderer/services/TabSessionRegistry'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { useEffect } from 'react'

/** Delay before retrying a release the cache refused while a page was still unmounting. */
const RELEASE_RETRY_MS = 1000

/**
 * Release tab sessions no longer reachable from any open tab.
 *
 * Reachability is the entire lifetime rule, so this replaces per-removal-path notifications:
 * closing a tab, detaching it and navigating it elsewhere all end the same way — the session id
 * stops appearing in a tab url — and no removal site has to remember to report anything.
 */
export function useTabSessionSweep(tabs: readonly Tab[]): void {
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined
    const sweep = () => {
      if (tabSessionRegistry.sweep(collectLiveSessionIds(tabs)) > 0) {
        retry = setTimeout(sweep, RELEASE_RETRY_MS)
      }
    }
    sweep()
    return () => clearTimeout(retry)
  }, [tabs])
}
