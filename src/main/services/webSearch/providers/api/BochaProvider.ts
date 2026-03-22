import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider, resolveProviderApiKey } from '../base/BaseWebSearchProvider'

const BochaSearchParamsSchema = z.object({
  query: z.string(),
  count: z.number().int().positive(),
  exclude: z.string(),
  summary: z.boolean()
})

const BochaSearchResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z.object({
    queryContext: z.object({
      originalQuery: z.string()
    }),
    webPages: z.object({
      value: z.array(
        z.object({
          name: z.string(),
          summary: z.string().optional(),
          snippet: z.string().optional(),
          url: z.string()
        })
      )
    })
  })
})

export class BochaProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const apiKey = resolveProviderApiKey(this.provider)

    const params = BochaSearchParamsSchema.parse({
      query,
      count: config.maxResults,
      exclude: config.excludeDomains.join(','),
      summary: true
    })

    const response = await net.fetch(this.resolveApiUrl('/v1/web-search'), {
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

    const payload = BochaSearchResponseSchema.parse(await response.json())

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
