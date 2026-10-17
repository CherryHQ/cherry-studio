import { net } from 'electron'
import * as z from 'zod'

import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { BaseSearchContext } from '../base/context'

const SerpKiteSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        snippet: z.string().nullish(),
        link: z.string()
      })
    )
    .nullish()
})

type SerpKiteSearchContext = BaseSearchContext & {
  apiKey: string
  requestUrl: string
}

export class SerpKiteProvider extends BaseWebSearchProvider {
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
  ): SerpKiteSearchContext {
    const params = new URLSearchParams({ q: query, num: String(config.maxResults) })

    return {
      apiKey: this.resolveApiKey(),
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', `/v1/search?${params.toString()}`),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: SerpKiteSearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'GET',
      headers: {
        ...defaultAppHeaders(),
        Accept: 'application/json',
        Authorization: `Bearer ${context.apiKey}`
      },
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('SerpKite search failed', response)
    }

    return this.parseJsonResponse(response, SerpKiteSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: SerpKiteSearchContext,
    searchPayload: z.infer<typeof SerpKiteSearchResponseSchema>
  ): WebSearchResponse {
    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: (searchPayload.results ?? []).slice(0, context.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.snippet?.trim() || '',
        url: item.link,
        sourceInput: context.query
      }))
    }
  }
}
