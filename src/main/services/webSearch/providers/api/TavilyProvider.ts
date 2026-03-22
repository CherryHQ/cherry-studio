import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider, resolveProviderApiKey } from '../base/BaseWebSearchProvider'

const TavilySearchRequestSchema = z.object({
  query: z.string(),
  api_key: z.string(),
  max_results: z.number().int().positive()
})

const TavilySearchResponseSchema = z.object({
  query: z.string().optional(),
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([])
})

export class TavilyProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const apiKey = resolveProviderApiKey(this.provider)
    const requestBody = TavilySearchRequestSchema.parse({
      query,
      api_key: apiKey,
      max_results: Math.max(1, config.maxResults)
    })

    const response = await net.fetch(this.resolveApiUrl('/search'), {
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

    const payload = TavilySearchResponseSchema.parse(await response.json())
    const results = payload.results

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
