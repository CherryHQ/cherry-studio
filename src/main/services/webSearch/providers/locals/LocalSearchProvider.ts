import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import { fetchSearchResultPageHtml } from './fetchers'

const logger = loggerService.withContext('LocalSearchProvider')

export interface SearchItem {
  title: string
  url: string
  content: string
}

function isAbortError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError')
}

export abstract class LocalSearchProvider extends BaseWebSearchProvider {
  async check(httpOptions?: RequestInit): Promise<void> {
    const items = await this.fetchSearchItems(this.getCheckQuery(), 1, httpOptions)

    if (items.length === 0) {
      throw new Error(`Local provider check failed: no parseable search results for ${this.provider.id}`)
    }
  }

  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const validItems = await this.fetchSearchItems(query, config.maxResults, httpOptions)

    return {
      query,
      results: validItems.map((item) => ({
        title: item.title,
        url: item.url,
        content: item.content
      }))
    }
  }

  protected applyLanguageFilter(query: string, language: string) {
    if (this.provider.id === 'local-google' || this.provider.id === 'local-bing') {
      return `${query} lang:${language.split('-')[0]}`
    }
    return query
  }

  protected extractSnippet(
    $element: {
      find: (selector: string) => { first: () => { text: () => string } }
      text: () => string
    },
    selectors: string[],
    title: string
  ): string {
    for (const selector of selectors) {
      const text = $element.find(selector).first().text().trim()
      if (text) {
        return text
      }
    }

    const fallbackText = $element.text().replace(title, '').replace(/\s+/g, ' ').trim()
    return fallbackText
  }

  protected abstract parseValidUrls(htmlContent: string): SearchItem[]

  private async fetchSearchItems(query: string, maxResults: number, httpOptions?: RequestInit): Promise<SearchItem[]> {
    this.assertNonEmptyQuery(query)

    try {
      const language = await preferenceService.get('app.language')
      const cleanedQuery = query.split('\r\n')[1] ?? query
      const queryWithLanguage = language ? this.applyLanguageFilter(cleanedQuery, language) : cleanedQuery
      const searchUrl = this.requireApiHost().replace('%s', encodeURIComponent(queryWithLanguage))

      const html = await fetchSearchResultPageHtml(searchUrl, httpOptions)
      const items = this.parseValidUrls(html)
        .filter((item) => item.url.startsWith('http://') || item.url.startsWith('https://'))
        .slice(0, maxResults)

      return Array.from(new Map(items.map((item) => [item.url, item])).values())
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      logger.error(`Local provider search failed: ${this.provider.id}`, error as Error)
      throw error
    }
  }
}
