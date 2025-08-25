import { loggerService } from '@logger'
import { WebSearchState } from '@renderer/store/websearch'
import { WebSearchProvider, WebSearchProviderResponse } from '@renderer/types'

import BaseWebSearchProvider from './BaseWebSearchProvider'

const logger = loggerService.withContext('ZhipuProvider')

interface ZhipuWebSearchRequest {
  search_query: string
  search_engine?: string
  search_intent?: boolean
}

interface ZhipuWebSearchResponse {
  id: string
  created: number
  request_id: string
  search_intent?: Array<{
    query: string
    intent: string
    keywords: string
  }>
  search_result: Array<{
    title: string
    content: string
    link: string
    media?: string
    icon?: string
    refer?: string
    publish_date?: string
  }>
}

export default class ZhipuProvider extends BaseWebSearchProvider {
  constructor(provider: WebSearchProvider) {
    super(provider)
    if (!this.apiKey) {
      throw new Error('API key is required for Zhipu provider')
    }
    if (!this.apiHost) {
      throw new Error('API host is required for Zhipu provider')
    }
  }

  public async search(query: string, websearch: WebSearchState): Promise<WebSearchProviderResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }

      const requestBody: ZhipuWebSearchRequest = {
        search_query: query,
        search_engine: 'search_std',
        search_intent: false
      }

      const response = await fetch(`${this.apiHost}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.defaultHeaders()
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Zhipu search failed:', { status: response.status, error: errorText })
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const data: ZhipuWebSearchResponse = await response.json()

      return {
        query: query,
        results: data.search_result.slice(0, websearch.maxResults).map((result) => {
          return {
            title: result.title || 'No title',
            content: result.content || '',
            url: result.link || ''
          }
        })
      }
    } catch (error) {
      logger.error('Zhipu search failed:', error as Error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
