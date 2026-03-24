import { loggerService } from '@logger'
import { isValidUrl } from '@shared/utils'
import { load } from 'cheerio'

import type { SearchItem } from './LocalSearchProvider'
import { LocalSearchProvider } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalBingProvider')

export class LocalBingProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const $ = load(htmlContent)
    const results: SearchItem[] = []

    $('#b_results .b_algo').each((_, element) => {
      const $element = $(element)
      const $link = $element.find('h2 a').first()
      const title = $link.text().trim()
      const href = $link.attr('href')
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
  }

  private decodeBingUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl, 'https://www.bing.com')
      return this.decodeRedirectTarget(url.searchParams.get('u')) ?? url.toString()
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.warn('Failed to decode Bing redirect URL', normalizedError)
      return rawUrl
    }
  }

  private decodeRedirectTarget(encodedUrl: string | null): string | null {
    if (!encodedUrl || encodedUrl.length <= 2) {
      return null
    }

    const decoded = Buffer.from(encodedUrl.slice(2), 'base64').toString('utf-8')
    return isValidUrl(decoded) ? decoded : null
  }
}
