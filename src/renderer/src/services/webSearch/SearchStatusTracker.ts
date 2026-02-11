import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type { WebSearchStatus } from '@renderer/types'

import type { ISearchStatusTracker } from './interfaces'

const logger = loggerService.withContext('SearchStatusTracker')

export class SearchStatusTracker implements ISearchStatusTracker {
  async setStatus(requestId: string, status: WebSearchStatus, delayMs?: number): Promise<void> {
    try {
      const activeSearches = cacheService.get('chat.web_search.active_searches') ?? {}
      activeSearches[requestId] = status
      cacheService.set('chat.web_search.active_searches', activeSearches)
    } catch (error) {
      // Status tracking failure should not break search functionality
      logger.debug('Failed to update search status:', error as Error)
    }

    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  clearStatus(requestId: string): void {
    try {
      const activeSearches = cacheService.get('chat.web_search.active_searches') ?? {}
      delete activeSearches[requestId]
      cacheService.set('chat.web_search.active_searches', activeSearches)
    } catch (error) {
      logger.debug('Failed to clear search status:', error as Error)
    }
  }
}
