import { loggerService } from '@logger'

import LocalSearchProvider, { SearchItem } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalBaiduProvider')

export default class LocalBaiduProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const results: SearchItem[] = []

    try {
      // Parse HTML string into a DOM document
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlContent, 'text/html')

      const items = doc.querySelectorAll('#content_left .result h3')
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
      logger.error('Failed to parse Baidu search HTML:', error as Error)
    }
    logger.info('Parsed Baidu search results:', results)
    return results
  }
}
