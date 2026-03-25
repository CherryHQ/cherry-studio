import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { resolveProviderApiKey } from '../../utils/provider'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

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

type BochaSearchContext = ApiKeyRequestSearchContext<z.infer<typeof BochaSearchParamsSchema>>

export class BochaProvider extends BaseWebSearchProvider {
  async search(query: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const context = this.prepareSearchContext(query, config, httpOptions)
    const searchPayload = await this.executeSearch(context)

    return this.buildFinalResponse(context, searchPayload)
  }

  private prepareSearchContext(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): BochaSearchContext {
    return {
      apiKey: resolveProviderApiKey(this.provider),
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('/v1/web-search'),
      requestBody: BochaSearchParamsSchema.parse({
        query,
        count: config.maxResults,
        exclude: config.excludeDomains.join(','),
        summary: true
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: BochaSearchContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      body: JSON.stringify(context.requestBody),
      headers: {
        ...defaultAppHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${context.apiKey}`
      },
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Bocha search failed', response)
    }

    return this.parseJsonResponse(response, BochaSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    _context: BochaSearchContext,
    searchPayload: z.infer<typeof BochaSearchResponseSchema>
  ): WebSearchResponse {
    if (searchPayload.code !== 200) {
      throw new Error(`Bocha search failed: ${searchPayload.msg}`)
    }

    return {
      query: searchPayload.data.queryContext.originalQuery,
      results: searchPayload.data.webPages.value.map((result) => ({
        title: result.name,
        content: result.summary || result.snippet || '',
        url: result.url
      }))
    }
  }
}
