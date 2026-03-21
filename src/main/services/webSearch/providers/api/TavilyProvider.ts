import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

interface TavilySearchRequest {
  query: string
  api_key: string
  max_results: number
}

interface TavilySearchResponse {
  query: string
  results: Array<{
    title?: string
    content?: string
    url?: string
  }>
}

export class TavilyProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    this.assertNonEmptyQuery(query)

    const apiKey = this.getApiKey()
    const requestBody: TavilySearchRequest = {
      query,
      api_key: apiKey,
      max_results: Math.max(1, config.maxResults)
    }

    const response = await this.netFetch(this.resolveApiUrl('/search'), {
      method: 'POST',
      headers: {
        ...this.defaultHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Tavily search failed: HTTP ${response.status} ${errorText}`)
    }

    const payload: TavilySearchResponse = await response.json()
    const results = payload.results || []

    return {
      query: payload.query || query,
      results: results.slice(0, config.maxResults).map((item) => ({
        title: item.title || 'No title',
        content: item.content || '',
        url: item.url || ''
      }))
    }
  }
}
