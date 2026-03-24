import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { resolveProviderApiKey } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { RequestSearchContext } from '../base/context'

const TavilySearchRequestSchema = z.object({
  query: z.string(),
  api_key: z.string(),
  max_results: z.number().int().positive()
})

const TavilySearchResponseSchema = z.object({
  query: z.string(),
  request_id: z.string(),
  response_time: z.union([z.number(), z.string()]),
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

type TavilySearchContext = RequestSearchContext<z.infer<typeof TavilySearchRequestSchema>>

export class TavilyProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const context = this.prepareSearchContext(query, config, httpOptions)
    const searchPayload = await this.executeSearch(context)

    return this.buildFinalResponse(context, searchPayload)
  }

  private prepareSearchContext(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): TavilySearchContext {
    const apiKey = resolveProviderApiKey(this.provider)

    return {
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('/search'),
      requestBody: TavilySearchRequestSchema.parse({
        query,
        api_key: apiKey,
        max_results: Math.max(1, config.maxResults)
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: TavilySearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      headers: {
        ...defaultAppHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(context.requestBody),
      signal: context.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Tavily search failed: HTTP ${response.status} ${errorText}`)
    }

    return TavilySearchResponseSchema.parse(await response.json())
  }

  private buildFinalResponse(
    context: TavilySearchContext,
    searchPayload: z.infer<typeof TavilySearchResponseSchema>
  ): WebSearchResponse {
    return {
      query: searchPayload.query || context.query,
      results: searchPayload.results.slice(0, context.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.content?.trim() || '',
        url: item.url || ''
      }))
    }
  }
}
