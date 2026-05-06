import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { resolveProviderApiKey } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

const TavilySearchRequestSchema = z.object({
  query: z.string(),
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

type TavilySearchContext = ApiKeyRequestSearchContext<z.infer<typeof TavilySearchRequestSchema>>

export class TavilyProvider extends BaseWebSearchProvider {
  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
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
      apiKey,
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', '/search'),
      requestBody: TavilySearchRequestSchema.parse({
        query,
        max_results: config.maxResults
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: TavilySearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.apiKey}`,
        ...defaultAppHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(context.requestBody),
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Tavily search failed', response)
    }

    return this.parseJsonResponse(response, TavilySearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: TavilySearchContext,
    searchPayload: z.infer<typeof TavilySearchResponseSchema>
  ): WebSearchResponse {
    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: searchPayload.results.slice(0, context.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.content?.trim() || '',
        url: item.url || '',
        sourceInput: context.query
      }))
    }
  }
}
