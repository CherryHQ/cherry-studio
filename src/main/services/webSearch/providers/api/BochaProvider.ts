import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { defaultAppHeaders } from '@shared/utils'
import { net } from 'electron'
import * as z from 'zod'

import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'
import type { ApiKeyRequestSearchContext } from '../base/context'

const BochaSearchParamsSchema = z.object({
  query: z.string(),
  count: z.number().int().min(1).max(50),
  exclude: z.string(),
  summary: z.boolean()
})

const BochaHttpErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  log_id: z.string().optional()
})

const BochaThumbnailSchema = z.object({
  height: z.number(),
  width: z.number()
})

const BochaWebPageSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string(),
  url: z.string(),
  displayUrl: z.string().optional(),
  snippet: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  siteName: z.string().nullable().optional(),
  siteIcon: z.string().nullable().optional(),
  datePublished: z.string().nullable().optional(),
  dateLastCrawled: z.string().nullable().optional(),
  cachedPageUrl: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  isFamilyFriendly: z.boolean().nullable().optional(),
  isNavigational: z.boolean().nullable().optional()
})

const BochaImagesSchema = z.object({
  id: z.string().nullable().optional(),
  readLink: z.string().nullable().optional(),
  webSearchUrl: z.string().nullable().optional(),
  isFamilyFriendly: z.boolean().nullable().optional(),
  value: z.array(
    z.object({
      webSearchUrl: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      thumbnailUrl: z.string(),
      datePublished: z.string().nullable().optional(),
      contentUrl: z.string(),
      hostPageUrl: z.string(),
      contentSize: z.string().nullable().optional(),
      encodingFormat: z.string().nullable().optional(),
      hostPageDisplayUrl: z.string().nullable().optional(),
      width: z.number(),
      height: z.number(),
      thumbnail: BochaThumbnailSchema.nullable().optional()
    })
  )
})

const BochaVideosSchema = z.object({
  id: z.string().nullable().optional(),
  readLink: z.string().nullable().optional(),
  webSearchUrl: z.string().nullable().optional(),
  isFamilyFriendly: z.boolean().nullable().optional(),
  scenario: z.string().optional(),
  value: z.array(
    z.object({
      webSearchUrl: z.string(),
      name: z.string(),
      description: z.string(),
      thumbnailUrl: z.string(),
      publisher: z.array(
        z.object({
          name: z.string()
        })
      ),
      creator: z.object({
        name: z.string()
      }),
      contentUrl: z.string(),
      hostPageUrl: z.string(),
      encodingFormat: z.string(),
      hostPageDisplayUrl: z.string(),
      width: z.number(),
      height: z.number(),
      duration: z.string(),
      motionThumbnailUrl: z.string(),
      embedHtml: z.string(),
      allowHttpsEmbed: z.boolean(),
      viewCount: z.number(),
      thumbnail: BochaThumbnailSchema,
      allowMobileEmbed: z.boolean(),
      isSuperfresh: z.boolean(),
      datePublished: z.string()
    })
  )
})

const BochaSearchResponseSchema = z.object({
  code: z.number(),
  log_id: z.string().optional(),
  msg: z.string().nullable().optional(),
  data: z.object({
    _type: z.string().optional(),
    queryContext: z.object({
      originalQuery: z.string()
    }),
    webPages: z.object({
      webSearchUrl: z.string().optional(),
      totalEstimatedMatches: z.number().optional(),
      value: z.array(BochaWebPageSchema),
      someResultsRemoved: z.boolean().optional()
    }),
    images: BochaImagesSchema.optional(),
    videos: BochaVideosSchema.nullable().optional()
  })
})

type BochaSearchContext = ApiKeyRequestSearchContext<z.infer<typeof BochaSearchParamsSchema>>

export class BochaProvider extends BaseWebSearchProvider {
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
  ): BochaSearchContext {
    return {
      apiKey: this.resolveApiKey(),
      query,
      maxResults: config.maxResults,
      requestUrl: this.resolveApiUrl('searchKeywords', '/v1/web-search'),
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
      await this.throwBochaHttpError(response)
    }

    return this.parseJsonResponse(response, BochaSearchResponseSchema, {
      operation: 'search',
      requestUrl: context.requestUrl
    })
  }

  private async throwBochaHttpError(response: Response): Promise<never> {
    const errorText = (await response.text()).trim()

    if (!errorText) {
      throw new Error(`Bocha search failed: HTTP ${response.status}`)
    }

    let parsedPayload: unknown

    try {
      parsedPayload = JSON.parse(errorText)
    } catch {
      // Fall back to the shared raw-body error formatter below.
      return this.throwHttpError('Bocha search failed', new Response(errorText, { status: response.status }))
    }

    const parsedError = BochaHttpErrorSchema.safeParse(parsedPayload)

    if (parsedError.success) {
      const { code, message, log_id } = parsedError.data
      const logIdPart = log_id ? `, log_id: ${log_id}` : ''
      throw new Error(`Bocha search failed: HTTP ${response.status} (code: ${code}${logIdPart}): ${message}`)
    }

    return this.throwHttpError('Bocha search failed', new Response(errorText, { status: response.status }))
  }

  private buildFinalResponse(
    context: BochaSearchContext,
    searchPayload: z.infer<typeof BochaSearchResponseSchema>
  ): WebSearchResponse {
    if (searchPayload.code !== 200) {
      throw new Error(`Bocha search failed (code: ${searchPayload.code}): ${searchPayload.msg ?? 'unknown error'}`)
    }

    return {
      query: context.query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [context.query],
      results: searchPayload.data.webPages.value.map((result) => ({
        title: result.name,
        content: result.summary || result.snippet || '',
        url: result.url,
        sourceInput: context.query
      }))
    }
  }
}
