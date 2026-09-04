import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
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
    // Querit declares every per-result field as Optional in its contract
    // (https://www.querit.ai/en/docs/reference/post); one incomplete item
    // must not invalidate the whole response.
    result: z
      .array(
        z.looseObject({
          title: z.string().optional(),
          snippet: z.string().optional(),
          url: z.string().optional(),
          site_name: z.string().optional(),
          page_age: z.string().optional(),
          site_icon: z.string().optional()
        })
      )
      .default([])
  })
})

const QueritContentsParamsSchema = z.object({
  urls: z.array(z.string()).min(1).max(10),
  format: z.string(),
  extrasMeta: z.boolean()
})

const QueritContentsResponseSchema = z.object({
  error_code: z.number(),
  error_msg: z.string(),
  results: z
    .array(
      z.object({
        url: z.string().optional(),
        content: z.string().optional(),
        extrasMeta: z
          .looseObject({
            title: z.string().optional()
          })
          .optional()
      })
    )
    .default([])
})

type QueritSearchContext = ApiKeyRequestSearchContext<z.infer<typeof QueritSearchParamsSchema>>
type QueritContentsContext = ApiKeyRequestSearchContext<z.infer<typeof QueritContentsParamsSchema>>

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

  async fetchUrls(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const context = this.prepareContentsContext(query, config, httpOptions)
    const contentsPayload = await this.executeContents(context)

    return this.buildContentsResponse(context, contentsPayload)
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    return {
      ...defaultAppHeaders(),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    }
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
      headers: this.buildHeaders(context.apiKey),
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
      results: (searchPayload.results?.result || [])
        // Drop items that have no usable URL — without one the caller can't
        // open the result, so it's better to omit than to surface a broken row.
        .filter((result) => typeof result.url === 'string' && result.url.length > 0)
        .map((result) => ({
          title: result.title ?? result.site_name ?? result.snippet ?? result.url ?? '',
          content: result.snippet || '',
          url: result.url ?? '',
          sourceInput: context.query
        }))
    }
  }

  private prepareContentsContext(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): QueritContentsContext {
    const url = query.trim()

    return {
      apiKey: this.resolveApiKey(),
      query: url,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('fetchUrls', '/v1/contents'),
      requestBody: QueritContentsParamsSchema.parse({
        urls: [url],
        format: 'markdown',
        // Querit only returns the page title when metadata is requested.
        extrasMeta: true
      }),
      signal: httpOptions?.signal ?? undefined
    }
  }

  private async executeContents(context: QueritContentsContext) {
    const response = await net.fetch(context.requestUrl, {
      method: 'POST',
      headers: this.buildHeaders(context.apiKey),
      body: JSON.stringify(context.requestBody),
      signal: context.signal
    })

    if (!response.ok) {
      await this.throwHttpError('Querit contents failed', response)
    }

    return this.parseJsonResponse(response, QueritContentsResponseSchema, {
      operation: 'contents',
      requestUrl: context.requestUrl
    })
  }

  private buildContentsResponse(
    context: QueritContentsContext,
    contentsPayload: z.infer<typeof QueritContentsResponseSchema>
  ): WebSearchResponse {
    if (contentsPayload.error_code !== 200) {
      throw new Error(`Querit contents failed: ${contentsPayload.error_msg}`)
    }

    const page = contentsPayload.results[0]
    const content = page?.content?.trim()

    if (!page || !content) {
      throw new Error(`Querit contents returned empty content for ${context.query}`)
    }

    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'fetchUrls',
      inputs: [context.query],
      results: [
        {
          title: page.extrasMeta?.title?.trim() || context.query,
          content,
          url: page.url || context.query,
          sourceInput: context.query
        }
      ]
    }
  }
}
