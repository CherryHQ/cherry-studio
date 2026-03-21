import { loggerService } from '@logger'
import { load } from 'cheerio'

import type { SearchItem } from './LocalSearchProvider'
import { LocalSearchProvider } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalBaiduProvider')

export class LocalBaiduProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    try {
      const $ = load(htmlContent)
      const results: SearchItem[] = []

      $('#content_left .result, #content_left .result-op').each((_, element) => {
        const $element = $(element)
        const title = $element.find('h3 a').first().text().trim()
        const href = $element.find('h3 a').first().attr('href')
        if (!title || !href) {
          return
        }

        results.push({
          title,
          url: this.normalizeUrl(href),
          content: this.extractSnippet(
            $element,
            ['.c-abstract', '.content-right_8Zs40', '.c-span-last', '.c-color-text'],
            title
          )
        })
      })

      return results
    } catch (error) {
      logger.error('Failed to parse Baidu search HTML', error as Error)
      return []
    }
  }

  private normalizeUrl(rawUrl: string): string {
    try {
      return new URL(rawUrl, 'https://www.baidu.com').toString()
    } catch {
      return rawUrl
    }
  }
}
