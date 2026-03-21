import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { fetchWebSearchContent, noContent } from '../../utils/fetchContent'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

interface SearxngSearchResponse {
  query?: string
  results?: Array<{
    title?: string
    content?: string
    snippet?: string
    url?: string
  }>
}

interface SearxngConfigResponse {
  engines?: Array<{
    enabled: boolean
    categories: string[]
    name: string
  }>
}

export class SearxngProvider extends BaseWebSearchProvider {
  private async resolveEngines(httpOptions?: RequestInit): Promise<string[]> {
    if (this.provider.engines.length > 0) {
      return this.provider.engines
    }

    const response = await this.netFetch(this.resolveApiUrl('/config'), {
      method: 'GET',
      headers: {
        ...this.defaultHeaders(),
        ...this.getBasicAuthHeaders()
      },
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Searxng config failed: HTTP ${response.status} ${errorText}`)
    }

    const payload: SearxngConfigResponse = await response.json()
    if (!Array.isArray(payload.engines)) {
      throw new Error('Invalid Searxng config response: "engines" is missing or not an array')
    }

    const engines = payload.engines
      .filter((engine) => engine.enabled && engine.categories.includes('general') && engine.categories.includes('web'))
      .map((engine) => engine.name)

    if (engines.length === 0) {
      throw new Error('No enabled general web search engines found in Searxng configuration')
    }

    return engines
  }

  async check(httpOptions?: RequestInit): Promise<void> {
    const engines = await this.resolveEngines(httpOptions)
    const searchParams = new URLSearchParams({
      q: this.getCheckQuery(),
      language: 'auto',
      format: 'json'
    })

    searchParams.set('engines', engines.join(','))

    const response = await this.netFetch(`${this.resolveApiUrl('/search')}?${searchParams.toString()}`, {
      method: 'GET',
      headers: {
        ...this.defaultHeaders(),
        ...this.getBasicAuthHeaders()
      },
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Searxng check failed: HTTP ${response.status} ${errorText}`)
    }

    const result: SearxngSearchResponse = await response.json()
    if (!Array.isArray(result.results)) {
      throw new Error('Invalid Searxng search response: "results" is missing or not an array')
    }
  }

  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    this.assertNonEmptyQuery(query)
    const engines = await this.resolveEngines(httpOptions)

    const searchParams = new URLSearchParams({
      q: query,
      language: 'auto',
      format: 'json'
    })

    searchParams.set('engines', engines.join(','))

    const response = await this.netFetch(`${this.resolveApiUrl('/search')}?${searchParams.toString()}`, {
      method: 'GET',
      headers: {
        ...this.defaultHeaders(),
        ...this.getBasicAuthHeaders()
      },
      signal: httpOptions?.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Searxng search failed: HTTP ${response.status} ${errorText}`)
    }

    const result: SearxngSearchResponse = await response.json()
    const validItems = (result.results || [])
      .filter((item) => item.url?.startsWith('http://') || item.url?.startsWith('https://'))
      .slice(0, config.maxResults)

    const fetchedResults = await Promise.all(
      validItems.map((item) => fetchWebSearchContent(item.url || '', this.provider.usingBrowser, httpOptions))
    )

    return {
      query: result.query || query,
      results: fetchedResults.filter((item) => item.content !== noContent)
    }
  }
}
