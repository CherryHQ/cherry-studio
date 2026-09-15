import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { BaseSearchContext } from '../base/context'

const SerplySearchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      description: z.string().nullish(),
      link: z.string()
    })
  )
})

type SerplySearchContext = BaseSearchContext & {
  apiKey: string
  requestUrl: string
}

export class SerplyProvider extends BaseWebSearchProvider {
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
  ): SerplySearchContext {
    // Serply encodes the search parameters in the path rather than the query string.
    const searchPath = `/v1/search/q=${encodeURIComponent(query)}&num=${config.maxResults}`

    return {
      apiKey: this.resolveApiKey(),
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', searchPath),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: SerplySearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'GET',
      headers: {
        ...defaultAppHeaders(),
        Accept: 'application/json',
        'X-Api-Key': context.apiKey
      },
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Serply search failed', response)
    }

    return this.parseJsonResponse(response, SerplySearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: SerplySearchContext,
    searchPayload: z.infer<typeof SerplySearchResponseSchema>
  ): WebSearchResponse {
    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: searchPayload.results.slice(0, context.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.description?.trim() || '',
        url: item.link,
        sourceInput: context.query
      }))
    }
  }
}
