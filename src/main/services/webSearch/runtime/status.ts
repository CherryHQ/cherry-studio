import { cacheService } from '@data/CacheService'
import type { WebSearchStatus } from '@shared/data/types/webSearch'

/**
 * Stores per-request web search status in shared cache for renderer observers.
 */
export async function setWebSearchStatus(requestId: string, status: WebSearchStatus, delayMs?: number) {
  const activeSearches = cacheService.getShared('chat.web_search.active_searches') || {}
  cacheService.setShared('chat.web_search.active_searches', {
    ...activeSearches,
    [requestId]: status
  })

  if (delayMs && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

/**
 * Clears per-request web search status once the request lifecycle completes.
 */
export async function clearWebSearchStatus(requestId: string) {
  const activeSearches = cacheService.getShared('chat.web_search.active_searches') || {}

  if (!(requestId in activeSearches)) {
    return
  }

  const { [requestId]: _removed, ...remaining } = activeSearches
  cacheService.setShared('chat.web_search.active_searches', remaining)
}
