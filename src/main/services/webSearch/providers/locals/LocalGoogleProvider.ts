import { loggerService } from '@logger'
import { load } from 'cheerio'

import type { SearchItem } from './LocalSearchProvider'
import { LocalSearchProvider } from './LocalSearchProvider'

const logger = loggerService.withContext('LocalGoogleProvider')

export class LocalGoogleProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    try {
      const $ = load(htmlContent)
      const results: SearchItem[] = []

      $('#search .MjjYud').each((_, element) => {
        const $element = $(element)
        const title = $element.find('h3').first().text().trim()
        const href = $element.find('a').first().attr('href')
        if (!title || !href) {
          return
        }

        const url = this.normalizeGoogleUrl(href)
        if (!url) {
          return
        }

        results.push({
          title,
          url,
          content: this.extractSnippet($element, ['.VwiC3b', '.yXK7lf', '.s3v9rd'], title)
        })
      })

      return results
    } catch (error) {
      logger.error('Failed to parse Google search HTML', error as Error)
      return []
    }
  }

  private normalizeGoogleUrl(rawUrl: string): string | null {
    try {
      const normalized = new URL(rawUrl, 'https://www.google.com')
      if (normalized.pathname === '/url') {
        const target = normalized.searchParams.get('q')
        return target || null
      }
      return normalized.toString()
    } catch {
      return null
    }
  }
}
