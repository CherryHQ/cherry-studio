import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider, resolveProviderApiHost, resolveProviderApiKey } from '../base/BaseWebSearchProvider'

const ZhipuWebSearchRequestSchema = z.object({
  search_query: z.string(),
  search_engine: z.string().optional(),
  search_intent: z.boolean().optional()
})

const ZhipuWebSearchResponseSchema = z.object({
  search_result: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        link: z.string().optional()
      })
    )
    .default([])
})

export class ZhipuProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const apiKey = resolveProviderApiKey(this.provider)

    const requestBody = ZhipuWebSearchRequestSchema.parse({
      search_query: query,
      search_engine: 'search_std',
      search_intent: false
    })

    const apiHost = resolveProviderApiHost(this.provider)

    const response = await net.fetch(apiHost, {
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

    const data = ZhipuWebSearchResponseSchema.parse(await response.json())

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
