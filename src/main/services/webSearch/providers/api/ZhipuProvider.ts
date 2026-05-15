import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { resolveProviderApiHost } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

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

type ZhipuSearchContext = ApiKeyRequestSearchContext<z.infer<typeof ZhipuWebSearchRequestSchema>>

export class ZhipuProvider extends BaseWebSearchProvider {
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
  ): ZhipuSearchContext {
    return {
      apiKey: this.resolveApiKey(),
      query,
      maxResults: config.maxResults,
      requestUrl: resolveProviderApiHost(this.provider, 'searchKeywords'),
      requestBody: ZhipuWebSearchRequestSchema.parse({
        search_query: query,
        search_engine: 'search_std',
        search_intent: false
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: ZhipuSearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.apiKey}`,
        'Content-Type': 'application/json',
        ...defaultAppHeaders()
      },
      body: JSON.stringify(context.requestBody),
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Zhipu search failed', response)
    }

    return this.parseJsonResponse(response, ZhipuWebSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: ZhipuSearchContext,
    searchPayload: z.infer<typeof ZhipuWebSearchResponseSchema>
  ): WebSearchResponse {
    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: searchPayload.search_result.slice(0, context.maxResults).map((result) => ({
        title: result.title?.trim() || '',
        content: result.content?.trim() || '',
        url: result.link || '',
        sourceInput: context.query
      }))
    }
  }
}
