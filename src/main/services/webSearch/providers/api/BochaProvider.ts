import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

interface BochaSearchParams {
  query: string
  count: number
  exclude: string
  freshness: 'oneDay' | 'noLimit'
  summary: boolean
  page: number
}

interface BochaSearchResponse {
  code: number
  msg: string
  data: {
    queryContext: { originalQuery: string }
    webPages: {
      value: Array<{
        name: string
        summary?: string
        snippet?: string
        url: string
      }>
    }
  }
}

export class BochaProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    this.assertNonEmptyQuery(query)

    const apiKey = this.getApiKey()

    const params: BochaSearchParams = {
      query,
      count: config.maxResults,
      exclude: config.excludeDomains.join(','),
      freshness: config.searchWithTime ? 'oneDay' : 'noLimit',
      summary: true,
      page: 1
    }

    const response = await this.netFetch(this.resolveApiUrl('/v1/web-search'), {
      method: 'POST',
      body: JSON.stringify(params),
      headers: {
        ...this.defaultHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      throw new Error(`Bocha search failed: ${response.status} ${response.statusText}`)
    }

    const payload: BochaSearchResponse = await response.json()

    if (payload.code !== 200) {
      throw new Error(`Bocha search failed: ${payload.msg}`)
    }

    return {
      query: payload.data.queryContext.originalQuery,
      results: payload.data.webPages.value.map((result) => ({
        title: result.name,
        content: result.summary || result.snippet || '',
        url: result.url
      }))
    }
  }
}
