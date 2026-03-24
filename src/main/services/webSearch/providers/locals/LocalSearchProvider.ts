import { loggerService } from '@logger'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { isValidUrl } from '@shared/utils'
import type { Cheerio } from 'cheerio'

import { isAbortError } from '../../utils/errors'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { UrlSearchContext } from '../base/context'
import { localBrowser } from './LocalBrowser'

const logger = loggerService.withContext('LocalSearchProvider')

export interface SearchItem {
  title: string
  url: string
  content: string
}

type LocalSearchContext = UrlSearchContext

export abstract class LocalSearchProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    try {
      const context = await this.prepareSearchContext(query, config, httpOptions)
      const searchItems = await this.executeSearch(context)

      return this.buildFinalResponse(context, searchItems)
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }

      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.error(`Local provider search failed: ${this.provider.id}`, normalizedError)
      throw error
    }
  }

  private async prepareSearchContext(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<LocalSearchContext> {
    return {
      query,
      maxResults: config.maxResults,
      searchUrl: this.provider.apiHost.replace('%s', encodeURIComponent(query)),
      signal: httpOptions?.signal ?? undefined
    }
  }

  protected extractSnippet($element: Cheerio<any>, selectors: string[], title: string): string {
    for (const selector of selectors) {
      const text = $element.find(selector).first().text().trim()
      if (text) {
        return text
      }
    }

    const fallbackText = $element.text().replace(title, '').replace(/\s+/g, ' ').trim()
    return fallbackText
  }

  protected resolveAbsoluteUrl(rawUrl: string, baseUrl: string): string {
    try {
      return new URL(rawUrl, baseUrl).toString()
    } catch {
      return rawUrl
    }
  }

  protected abstract parseValidUrls(htmlContent: string): SearchItem[]

  private async executeSearch(context: LocalSearchContext): Promise<SearchItem[]> {
    const html = await localBrowser.fetchHtml(context.searchUrl, { signal: context.signal })

    try {
      return this.parseValidUrls(html)
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      throw new Error(`Failed to parse local search results: ${this.provider.id}`, {
        cause: normalizedError
      })
    }
  }

  private buildFinalResponse(context: LocalSearchContext, searchItems: SearchItem[]): WebSearchResponse {
    const validItems = Array.from(
      new Map(searchItems.filter((item) => isValidUrl(item.url)).map((item) => [item.url, item])).values()
    ).slice(0, context.maxResults)

    return {
      query: context.query,
      results: validItems.map((item) => ({
        title: item.title,
        url: item.url,
        content: item.content
      }))
    }
  }
}
