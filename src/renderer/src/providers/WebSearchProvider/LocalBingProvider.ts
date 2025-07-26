import { loggerService } from '@logger'

import LocalSearchProvider, { SearchItem } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalBingProvider')

export default class LocalBingProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const results: SearchItem[] = []

    try {
      // Parse HTML string into a DOM document
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlContent, 'text/html')

      const items = doc.querySelectorAll('#b_results h2')
      items.forEach((item) => {
        const node = item.querySelector('a')
        if (node) {
          results.push({
            title: node.textContent || '',
            url: node.href
          })
        }
      })
    } catch (error) {
      logger.error('Failed to parse Bing search HTML:', error as Error)
    }
    return results
  }
}
