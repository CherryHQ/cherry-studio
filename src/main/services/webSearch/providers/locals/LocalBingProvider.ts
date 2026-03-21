import { loggerService } from '@logger'
import { load } from 'cheerio'

import type { SearchItem } from './LocalSearchProvider'
import { LocalSearchProvider } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalBingProvider')

export class LocalBingProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    try {
      const $ = load(htmlContent)
      const results: SearchItem[] = []

      $('#b_results .b_algo').each((_, element) => {
        const $element = $(element)
        const title = $element.find('h2 a').first().text().trim()
        const href = $element.find('h2 a').first().attr('href')
        if (!title || !href) {
          return
        }

        results.push({
          title,
          url: this.decodeBingUrl(href),
          content: this.extractSnippet($element, ['.b_caption p', '.b_snippet', '.lisn_content'], title)
        })
      })

      return results
    } catch (error) {
      logger.error('Failed to parse Bing search HTML', error as Error)
      return []
    }
  }

  private decodeBingUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl, 'https://www.bing.com')
      const encodedUrl = url.searchParams.get('u')

      if (!encodedUrl || encodedUrl.length <= 2) {
        return url.toString()
      }

      const decoded = Buffer.from(encodedUrl.substring(2), 'base64').toString('utf-8')
      return decoded.startsWith('http://') || decoded.startsWith('https://') ? decoded : url.toString()
    } catch (error) {
      logger.warn('Failed to decode Bing redirect URL', error as Error)
      return rawUrl
    }
  }
}
