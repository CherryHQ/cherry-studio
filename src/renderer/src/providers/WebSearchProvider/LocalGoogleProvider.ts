import { loggerService } from '@logger'

import LocalSearchProvider, { SearchItem } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalGoogleProvider')

export default class LocalGoogleProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const results: SearchItem[] = []

    try {
      // Parse HTML string into a DOM document
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlContent, 'text/html')

      const items = doc.querySelectorAll('#search .MjjYud')
      items.forEach((item) => {
        const title = item.querySelector('h3')
        const link = item.querySelector('a')
        if (title && link) {
          results.push({
            title: title.textContent || '',
            url: link.href
          })
        }
      })
    } catch (error) {
      logger.error('Failed to parse Google search HTML:', error as Error)
    }
    return results
  }
}
