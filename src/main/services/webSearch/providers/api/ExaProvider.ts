import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

interface ExaSearchRequest {
  query: string
  numResults: number
  contents: {
    text: boolean
  }
}

interface ExaSearchResponse {
  results: Array<{
    title: string | null
    text?: string
    url?: string
  }>
  autopromptString?: string
}

export class ExaProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    this.assertNonEmptyQuery(query)

    const apiKey = this.getApiKey()
    const requestBody: ExaSearchRequest = {
      query,
      numResults: Math.max(1, config.maxResults),
      contents: {
        text: true
      }
    }

    const response = await this.netFetch(this.resolveApiUrl('/search'), {
      method: 'POST',
      headers: {
        ...this.defaultHeaders(),
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(requestBody),
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Exa search failed: HTTP ${response.status} ${errorText}`)
    }

    const payload: ExaSearchResponse = await response.json()
    const results = payload.results || []

    return {
      query: payload.autopromptString || query,
      results: results.slice(0, config.maxResults).map((item) => ({
        title: item.title || 'No title',
        content: item.text || '',
        url: item.url || ''
      }))
    }
  }
}
