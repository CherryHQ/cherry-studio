import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, checkProviderError, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const FirecrawlScrapeResponseSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  data: z
    .object({
      markdown: z.string().optional(),
      metadata: z
        .looseObject({
          // Firecrawl types title as string | string[]; accept both so a valid response never fails validation.
          title: z.union([z.string(), z.array(z.string())]).optional(),
          sourceURL: z.string().optional()
        })
        .optional()
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

export const firecrawl: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.firecrawl,
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const payload = await requestJson(
        context,
        {
          url: apiUrl(context.apiHost, '/v2/search'),
          method: 'POST',
          headers: bearer(context),
          body: { query: call.input, limit: call.config.maxResults, scrapeOptions: { formats: ['markdown'] } }
        },
        FirecrawlSearchResponseSchema,
        (value) => checkProviderError(context, value, 'success')
      )
      return (payload.data?.web || []).slice(0, call.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.markdown?.trim() || item.description?.trim() || '',
        url: item.url || '',
        sourceInput: call.input
      }))
    }
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v2/scrape'),
        method: 'POST',
        headers: bearer(context),
        body: { url: call.input.trim(), formats: ['markdown'] }
      },
      FirecrawlScrapeResponseSchema,
      (value) => checkProviderError(context, value, 'success')
    )
    const content = payload.data?.markdown?.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Firecrawl scrape returned empty content')
    const metadata = payload.data?.metadata
    const title = Array.isArray(metadata?.title) ? metadata.title[0] : metadata?.title
    return [
      { title: title?.trim() || call.input, content, url: metadata?.sourceURL || call.input, sourceInput: call.input }
    ]
  }
}
