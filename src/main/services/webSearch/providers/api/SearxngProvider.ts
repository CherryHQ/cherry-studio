import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { fetchWebSearchContent, noContent } from '../../utils/fetchContent'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

const SearxngSearchResponseSchema = z.object({
  query: z.string().optional(),
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        snippet: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([])
})

const SearxngConfigResponseSchema = z.object({
  engines: z.array(
    z.object({
      enabled: z.boolean(),
      categories: z.array(z.string()),
      name: z.string()
    })
  )
})

export class SearxngProvider extends BaseWebSearchProvider {
  private async resolveEngines(httpOptions?: RequestInit): Promise<string[]> {
    if (this.provider.engines.length > 0) {
      return this.provider.engines
    }

    const response = await net.fetch(this.resolveApiUrl('/config'), {
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

    const payload = SearxngConfigResponseSchema.parse(await response.json())

    const engines = payload.engines
      .filter((engine) => engine.enabled && engine.categories.includes('general') && engine.categories.includes('web'))
      .map((engine) => engine.name)

    if (engines.length === 0) {
      throw new Error('No enabled general web search engines found in Searxng configuration')
    }

    return engines
  }

  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const engines = await this.resolveEngines(httpOptions)

    const searchParams = new URLSearchParams({
      q: query,
      language: 'auto',
      format: 'json'
    })

    searchParams.set('engines', engines.join(','))

    const response = await net.fetch(`${this.resolveApiUrl('/search')}?${searchParams.toString()}`, {
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

    const result = SearxngSearchResponseSchema.parse(await response.json())
    const validItems = result.results
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
