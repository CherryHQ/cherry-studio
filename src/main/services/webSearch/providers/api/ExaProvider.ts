import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider, resolveProviderApiKey } from '../base/BaseWebSearchProvider'

const ExaSearchRequestSchema = z.object({
  query: z.string(),
  numResults: z.number().int().positive(),
  contents: z.object({
    text: z.boolean()
  })
})

const ExaSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullable().optional(),
        text: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([]),
  autopromptString: z.string().optional()
})

export class ExaProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const apiKey = resolveProviderApiKey(this.provider)
    const requestBody = ExaSearchRequestSchema.parse({
      query,
      numResults: Math.max(1, config.maxResults),
      contents: {
        text: true
      }
    })

    const response = await net.fetch(this.resolveApiUrl('/search'), {
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

    const payload = ExaSearchResponseSchema.parse(await response.json())
    const results = payload.results

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
