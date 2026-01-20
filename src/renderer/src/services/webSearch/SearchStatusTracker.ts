import { cacheService } from '@data/CacheService'
import type { WebSearchStatus } from '@renderer/types'

import type { ISearchStatusTracker } from './interfaces'

export class SearchStatusTracker implements ISearchStatusTracker {
  async setStatus(requestId: string, status: WebSearchStatus, delayMs?: number): Promise<void> {
    const activeSearches = cacheService.get('chat.websearch.active_searches') ?? {}
    activeSearches[requestId] = status
    cacheService.set('chat.websearch.active_searches', activeSearches)

    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  clearStatus(requestId: string): void {
    const activeSearches = cacheService.get('chat.websearch.active_searches') ?? {}
    delete activeSearches[requestId]
    cacheService.set('chat.websearch.active_searches', activeSearches)
  }
}
