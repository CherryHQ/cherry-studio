import { loggerService } from '@logger'
import type { WebSearchState } from '@renderer/store/websearch'
import type { WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('QueritProvider')

interface QueritSearchResult {
  url: string
  page_age: string
  title: string
  snippet: string
  site_name: string
}

interface QueritSearchResponse {
  took: string
  error_code: number
  error_msg: string
  search_id: number
  query_context: {
    query: string
  }
  results: {
    result: QueritSearchResult[]
  }
}

export default class QueritProvider extends BaseWebSearchProvider {
  public async search(query: string, websearch: WebSearchState): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      }

      const params: Record<string, unknown> = {
        query,
        count: websearch.maxResults
      }

      const requestUrl = `${this.apiHost}/v1/search`

      const response = await fetch(requestUrl, {
        method: 'POST',
        body: JSON.stringify(params),
        headers: {
          ...this.defaultHeaders(),
          ...headers
        }
      })

      if (!response.ok) {
        throw new Error(`Querit search failed: ${response.status} ${response.statusText}`)
      }

      const resp: QueritSearchResponse = await response.json()

      if (resp.error_code !== 200) {
        throw new Error(`Querit search failed: ${resp.error_msg}`)
      }

      return {
        query: resp.query_context.query,
        results: (resp.results?.result || []).map((result) => ({
          title: result.title,
          content: result.snippet || '',
          url: result.url
        }))
      }
    } catch (error) {
      logger.error('Querit search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
