import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

interface ZhipuWebSearchRequest {
  search_query: string
  search_engine?: string
  search_intent?: boolean
}

interface ZhipuWebSearchResponse {
  search_result: Array<{
    title: string
    content: string
    link: string
  }>
}

export class ZhipuProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    this.assertNonEmptyQuery(query)

    const apiKey = this.getApiKey()

    const requestBody: ZhipuWebSearchRequest = {
      search_query: query,
      search_engine: 'search_std',
      search_intent: false
    }

    const response = await this.netFetch(this.requireApiHost(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.defaultHeaders()
      },
      body: JSON.stringify(requestBody),
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Zhipu search failed: HTTP ${response.status} ${errorText}`)
    }

    const data: ZhipuWebSearchResponse = await response.json()

    return {
      query,
      results: data.search_result.slice(0, config.maxResults).map((result) => ({
        title: result.title || 'No title',
        content: result.content || '',
        url: result.link || ''
      }))
    }
  }
}
