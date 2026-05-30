import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

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

type QueritSearchContext = ApiKeyRequestSearchContext<z.infer<typeof QueritSearchParamsSchema>>

export class QueritProvider extends BaseWebSearchProvider {
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
  ): QueritSearchContext {
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

    return {
      apiKey: this.resolveApiKey(),
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', '/v1/search'),
      requestBody,
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: QueritSearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      headers: {
        ...defaultAppHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${context.apiKey}`
      },
      body: JSON.stringify(context.requestBody),
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Querit search failed', response)
    }

    return this.parseJsonResponse(response, QueritSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: QueritSearchContext,
    searchPayload: z.infer<typeof QueritSearchResponseSchema>
  ): WebSearchResponse {
    if (searchPayload.error_code !== 200) {
      throw new Error(`Querit search failed: ${searchPayload.error_msg}`)
    }

    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: (searchPayload.results?.result || []).map((result) => ({
        title: result.title,
        content: result.snippet || '',
        url: result.url,
        sourceInput: context.query
      }))
    }
  }
}
