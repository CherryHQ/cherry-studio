import type { CacheActiveSearches } from '@shared/data/cache/cacheValueTypes'
import type { WebSearchStatus } from '@shared/data/types/webSearch'
import { Mutex } from 'async-mutex'

const statusCacheMutex = new Mutex()

export interface WebSearchStatusCache {
  getShared(key: 'chat.web_search.active_searches'): CacheActiveSearches | undefined
  setShared(key: 'chat.web_search.active_searches', value: CacheActiveSearches): void
}

async function writeActiveSearches(
  cache: WebSearchStatusCache,
  updater: (activeSearches: CacheActiveSearches) => CacheActiveSearches | undefined
): Promise<void> {
  await statusCacheMutex.runExclusive(() => {
    const activeSearches = cache.getShared('chat.web_search.active_searches') || {}
    const nextActiveSearches = updater(activeSearches)

    if (nextActiveSearches) {
      cache.setShared('chat.web_search.active_searches', nextActiveSearches)
    }
  })
}

async function writeWebSearchStatus(
  cache: WebSearchStatusCache,
  requestId: string,
  status?: WebSearchStatus
): Promise<void> {
  await writeActiveSearches(cache, (activeSearches) => {
    if (!status && !(requestId in activeSearches)) {
      return undefined
    }

    const nextActiveSearches = { ...activeSearches }

    if (status) {
      nextActiveSearches[requestId] = status
    } else {
      delete nextActiveSearches[requestId]
    }

    return nextActiveSearches
  })
}

/**
 * Stores per-request web search status in shared cache for renderer observers.
 */
export async function setWebSearchStatus(
  cache: WebSearchStatusCache,
  requestId: string,
  status: WebSearchStatus,
  delayMs?: number
) {
  await writeWebSearchStatus(cache, requestId, status)

  if (delayMs && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

/**
 * Clears per-request web search status once the request lifecycle completes.
 */
export async function clearWebSearchStatus(cache: WebSearchStatusCache, requestId: string) {
  await writeWebSearchStatus(cache, requestId)
}
