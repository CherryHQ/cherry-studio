import { loggerService } from '@logger'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'
import { BochaSearchParams, BochaSearchResponse } from '@renderer/utils/bocha'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('BochaProvider')

export default class BochaProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Bocha provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Bocha provider')
    }
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      }

      const params: BochaSearchParams = {
        query,
        count: websearch.maxResults,
        exclude: websearch.excludeDomains.join(','),
        freshness: websearch.searchWithTime ? 'oneDay' : 'noLimit',
        summary: true,
        page: 1
      }

      const response = await fetch(`${this.apiHost}/v1/web-search`, {
        method: 'POST',
        body: JSON.stringify(params),
        headers: {
          ...this.defaultHeaders(),
          ...headers
        }
      })

      if (!response.ok) {
        throw new Error(`Bocha search failed: ${response.status} ${response.statusText}`)
      }

      const resp: BochaSearchResponse = await response.json()
      if (resp.code !== 200) {
        throw new Error(`Bocha search failed: ${resp.msg}`)
      }
      return {
        query: resp.data.queryContext.originalQuery,
        results: resp.data.webPages.value.map((result) => ({
          title: result.name,
          // 优先使用 summary（更详细），如果没有则使用 snippet
          content: result.summary || result.snippet || '',
          url: result.url
        }))
      }
    } catch (error) {
      logger.error('Bocha search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
