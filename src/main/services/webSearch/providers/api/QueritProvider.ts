import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

interface QueritSearchParams {
  query: string
  count: number
  filters?: {
    sites?: { exclude: string[] }
    timeRange?: { date: string }
  }
}

interface QueritSearchResponse {
  error_code: number
  error_msg: string
  query_context: {
    query: string
  }
  results: {
    result: Array<{
      title: string
      snippet?: string
      url: string
    }>
  }
}

export class QueritProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    this.assertNonEmptyQuery(query)

    const apiKey = this.getApiKey()
    const requestBody: QueritSearchParams = {
      query,
      count: config.maxResults
    }

    const filters: QueritSearchParams['filters'] = {}
    if (config.excludeDomains.length > 0) {
      filters.sites = { exclude: config.excludeDomains }
    }
    if (config.searchWithTime) {
      filters.timeRange = { date: 'd1' }
    }
    if (Object.keys(filters).length > 0) {
      requestBody.filters = filters
    }

    const response = await this.netFetch(this.resolveApiUrl('/v1/search'), {
      method: 'POST',
      headers: {
        ...this.defaultHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      throw new Error(`Querit search failed: ${response.status} ${response.statusText}`)
    }

    const payload: QueritSearchResponse = await response.json()

    if (payload.error_code !== 200) {
      throw new Error(`Querit search failed: ${payload.error_msg}`)
    }

    return {
      query: payload.query_context.query,
      results: (payload.results?.result || []).map((result) => ({
        title: result.title,
        content: result.snippet || '',
        url: result.url
      }))
    }
  }
}
