import { net } from 'electron'
import * as z from 'zod'

import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

const ParallelSearchRequestSchema = z.object({
  objective: z.string(),
  search_queries: z.array(z.string()).min(1),
  advanced_settings: z.object({
    max_results: z.number().int().positive()
  })
})

const ParallelSearchResponseSchema = z.object({
  search_id: z.string(),
  session_id: z.string(),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      excerpts: z.array(z.string())
    })
  )
})

type ParallelSearchContext = ApiKeyRequestSearchContext<z.infer<typeof ParallelSearchRequestSchema>>

export class ParallelProvider extends BaseWebSearchProvider {
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
  ): ParallelSearchContext {
    return {
      apiKey: this.resolveApiKey(),
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', '/v1/search'),
      requestBody: ParallelSearchRequestSchema.parse({
        objective: query,
        search_queries: [query],
        advanced_settings: {
          max_results: config.maxResults
        }
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: ParallelSearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      headers: {
        ...defaultAppHeaders(),
        'Content-Type': 'application/json',
        'x-api-key': context.apiKey
      },
      body: JSON.stringify(context.requestBody),
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Parallel search failed', response)
    }

    return this.parseJsonResponse(response, ParallelSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: ParallelSearchContext,
    searchPayload: z.infer<typeof ParallelSearchResponseSchema>
  ): WebSearchResponse {
    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: searchPayload.results.slice(0, context.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.excerpts
          .map((excerpt) => excerpt.trim())
          .filter(Boolean)
          .join('\n\n'),
        url: item.url,
        sourceInput: context.query
      }))
    }
  }
}
