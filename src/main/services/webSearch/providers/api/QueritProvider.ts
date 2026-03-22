import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider, resolveProviderApiKey } from '../base/BaseWebSearchProvider'

const QueritSearchParamsSchema = z.object({
  query: z.string(),
  count: z.number().int().positive(),
  filters: z
    .object({
      sites: z
        .object({
          exclude: z.array(z.string())
        })
        .optional()
    })
    .optional()
})

const QueritSearchResponseSchema = z.object({
  error_code: z.number(),
  error_msg: z.string(),
  query_context: z.object({
    query: z.string()
  }),
  results: z.object({
    result: z
      .array(
        z.object({
          title: z.string(),
          snippet: z.string().optional(),
          url: z.string()
        })
      )
      .default([])
  })
})

export class QueritProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const apiKey = resolveProviderApiKey(this.provider)
    const requestBody = QueritSearchParamsSchema.parse({
      query,
      count: config.maxResults
    })

    const filters: z.input<typeof QueritSearchParamsSchema>['filters'] = {}
    if (config.excludeDomains.length > 0) {
      filters.sites = { exclude: config.excludeDomains }
    }
    if (Object.keys(filters).length > 0) {
      requestBody.filters = filters
    }

    const response = await net.fetch(this.resolveApiUrl('/v1/search'), {
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

    const payload = QueritSearchResponseSchema.parse(await response.json())

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
