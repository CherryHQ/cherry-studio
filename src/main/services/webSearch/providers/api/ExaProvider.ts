import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { resolveProviderApiKey } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

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

type ExaSearchContext = ApiKeyRequestSearchContext<z.infer<typeof ExaSearchRequestSchema>>

export class ExaProvider extends BaseWebSearchProvider {
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
  ): ExaSearchContext {
    const apiKey = resolveProviderApiKey(this.provider)

    return {
      apiKey,
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', '/search'),
      requestBody: ExaSearchRequestSchema.parse({
        query,
        numResults: config.maxResults,
        contents: {
          text: true
        }
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: ExaSearchContext) {
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
      await this.throwHttpError('Exa search failed', response)
    }

    return this.parseJsonResponse(response, ExaSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: ExaSearchContext,
    searchPayload: z.infer<typeof ExaSearchResponseSchema>
  ): WebSearchResponse {
    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: searchPayload.results.slice(0, context.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.text?.trim() || '',
        url: item.url || '',
        sourceInput: context.query
      }))
    }
  }
}
