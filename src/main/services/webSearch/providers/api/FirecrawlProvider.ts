import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

const FirecrawlSearchRequestSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().optional(),
  scrapeOptions: z
    .object({
      formats: z.array(z.string()).optional()
    })
    .optional()
})

const FirecrawlSearchResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  data: z
    .object({
      web: z
        .array(
          z.object({
            title: z.string().optional(),
            markdown: z.string().optional(),
            description: z.string().optional(),
            url: z.string().optional()
          })
        )
        .default([])
    })
    .optional()
})

type FirecrawlSearchContext = ApiKeyRequestSearchContext<z.infer<typeof FirecrawlSearchRequestSchema>>

export class FirecrawlProvider extends BaseWebSearchProvider {
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
  ): FirecrawlSearchContext {
    const resolvedApiKey = this.resolveApiKey(false)

    return {
      apiKey: resolvedApiKey,
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', '/v2/search'),
      requestBody: FirecrawlSearchRequestSchema.parse({
        query,
        limit: config.maxResults,
        scrapeOptions: {
          formats: ['markdown']
        }
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeSearch(context: FirecrawlSearchContext) {
    const headers: Record<string, string> = {
      ...defaultAppHeaders(),
      'Content-Type': 'application/json'
    }

    if (context.apiKey) {
      headers['Authorization'] = `Bearer ${context.apiKey}`
    }

    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(context.requestBody),
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Firecrawl search failed', response)
    }

    return this.parseJsonResponse(response, FirecrawlSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private buildFinalResponse(
    context: FirecrawlSearchContext,
    searchPayload: z.infer<typeof FirecrawlSearchResponseSchema>
  ): WebSearchResponse {
    if (searchPayload.success === false) {
      throw new Error(`Firecrawl search failed: ${searchPayload.error ?? 'unknown error'}`)
    }

    const webResults = searchPayload.data?.web ?? []

    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: webResults.slice(0, context.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.markdown?.trim() || item.description?.trim() || '',
        url: item.url || '',
        sourceInput: context.query
      }))
    }
  }
}
