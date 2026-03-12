import { loggerService } from '@logger'

import type { SearchItem } from './LocalSearchProvider'
import LocalSearchProvider from './LocalSearchProvider'

const logger = loggerService.withContext('LocalDuckDuckGoProvider')

export default class LocalDuckDuckGoProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const results: SearchItem[] = []

    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlContent, 'text/html')

      const items = doc.querySelectorAll('.result')
      items.forEach((resultEl) => {
        const titleEl = resultEl.querySelector('.result__title a')
        if (!titleEl) {
          return
        }

        const link = (titleEl as HTMLAnchorElement).href
        // Skip ad results
        if (link.includes('y.js')) {
          return
        }

        const resolvedUrl = this.decodeDuckDuckGoUrl(link)
        results.push({
          title: titleEl.textContent?.trim() ?? '',
          url: resolvedUrl
        })
      })
    } catch (error) {
      logger.error('Failed to parse DuckDuckGo search HTML:', error as Error)
    }
    logger.info('Parsed DuckDuckGo search results:', results)
    return results
  }

  /**
   * Decode DuckDuckGo redirect URL to get the actual destination.
   * Links may be in format: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
   * The 'uddg' parameter contains the URL-encoded destination.
   */
  private decodeDuckDuckGoUrl(ddgUrl: string): string {
    try {
      // Handle protocol-relative or absolute redirect URL
      const normalized = ddgUrl.startsWith('//') ? `https:${ddgUrl}` : ddgUrl
      const url = new URL(normalized)
      if (!url.pathname.includes('/l/')) {
        return ddgUrl
      }

      const encodedUrl = url.searchParams.get('uddg')
      if (!encodedUrl) {
        return ddgUrl
      }

      const decoded = decodeURIComponent(encodedUrl)
      if (decoded.startsWith('http')) {
        return decoded
      }

      return ddgUrl
    } catch (error) {
      logger.warn('Failed to decode DuckDuckGo URL:', error as Error)
      return ddgUrl
    }
  }
}
