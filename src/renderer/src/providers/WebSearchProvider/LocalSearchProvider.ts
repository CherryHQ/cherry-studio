import { loggerService } from '@logger'
import { nanoid } from '@reduxjs/toolkit'
import store from '@renderer/store'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchProviderResponse, WebSearchProviderResult } from '@renderer/types'
import { createAbortPromise } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { fetchWebContent, noContent } from '@renderer/utils/fetch'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('LocalSearchProvider')

export interface SearchItem {
  title: string
  url: string
}

export default class LocalSearchProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    if (!provider || !provider.url) {
      throw new Error('Provider URL is required')
    }
    super(provider)
  }

  public async search(
    query: string,
    websearch: WebSearchState,
    httpOptions?: RequestInit
  ): Promise<WebSearchProviderResponse> {
    const uid = nanoid()
    const language = store.getState().settings.language
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }
      if (!this.provider.url) {
        throw new Error('Provider URL is required')
      }

      const cleanedQuery = query.split('\r\n')[1] ?? query
      const queryWithLanguage = language ? this.applyLanguageFilter(cleanedQuery, language) : cleanedQuery
      const url = this.provider.url.replace('%s', encodeURIComponent(queryWithLanguage))
      let content: string = ''
      const promisesToRace: [Promise<string>] = [window.api.searchService.openUrlInSearchWindow(uid, url)]
      if (httpOptions?.signal) {
        const abortPromise = createAbortPromise(httpOptions.signal, promisesToRace[0])
        promisesToRace.push(abortPromise)
      }
      content = await Promise.race(promisesToRace)

      // Parse the content to extract URLs and metadata
      const searchItems = this.parseValidUrls(content).slice(0, websearch.maxResults)

      const validItems = searchItems
        .filter((item) => item.url.startsWith('http') || item.url.startsWith('https'))
        .slice(0, websearch.maxResults)
      // Logger.log('Valid search items:', validItems)

      // Fetch content for each URL concurrently
      const fetchPromises = validItems.map(async (item) => {
        // Logger.log(`Fetching content for ${item.url}...`)
        return await fetchWebContent(item.url, 'markdown', this.provider.usingBrowser, httpOptions)
      })

      // Wait for all fetches to complete
      const results: WebSearchProviderResult[] = await Promise.all(fetchPromises)

      return {
        query: query,
        results: results.filter((result) => result.content != noContent)
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      logger.error('Local search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      await window.api.searchService.closeSearchWindow(uid)
    }
  }

  /**
   * 根据提供的语言为查询添加语言过滤器
   * @param query 原始查询
   * @param language 语言代码 (例如: 'zh-CN', 'en-US')
   * @returns 带有语言过滤的查询
   */
  protected applyLanguageFilter(query: string, language: string): string {
    if (this.provider.id.includes('local-google')) {
      return `${query} lang:${language.split('-')[0]}`
    }
    if (this.provider.id.includes('local-bing')) {
      return `${query} language:${language}`
    }
    if (this.provider.id.includes('local-baidu')) {
      return `${query} language:${language.split('-')[0]}`
    }
    return query
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected parseValidUrls(_htmlContent: string): SearchItem[] {
    throw new Error('Not implemented')
  }
}
