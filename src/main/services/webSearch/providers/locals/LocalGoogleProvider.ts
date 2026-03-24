import { load } from 'cheerio'

import type { SearchItem } from './LocalSearchProvider'
import { LocalSearchProvider } from './LocalSearchProvider'

export class LocalGoogleProvider extends LocalSearchProvider {
  protected parseValidUrls(htmlContent: string): SearchItem[] {
    const $ = load(htmlContent)
    const results: SearchItem[] = []

    $('#search .MjjYud').each((_, element) => {
      const $element = $(element)
      const $title = $element.find('h3').first()
      const $parentLink = $title.parents('a').first()
      const $nestedLink = $title.find('a').first()
      const $link =
        $parentLink.length > 0 ? $parentLink : $nestedLink.length > 0 ? $nestedLink : $element.find('a').first()
      const title = $title.text().trim() || $link.text().trim()
      const href = $link.attr('href')
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
  }

  private normalizeGoogleUrl(rawUrl: string): string | null {
    try {
      const normalized = new URL(this.resolveAbsoluteUrl(rawUrl, 'https://www.google.com'))
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
