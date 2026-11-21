import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

// The Search API rejects a limit above 25 with HTTP 400.
const MAX_SEARCH_LIMIT = 25

const OlostepSearchResponseSchema = z.object({
  result: z.object({
    links: z
      .array(
        z.object({
          url: z.string(),
          title: z.string().nullish(),
          description: z.string().nullish()
        })
      )
      .nullish()
  })
})

const OlostepScrapeResponseSchema = z.object({
  result: z.object({
    markdown_content: z.string().nullish()
  })
})

export const olostep: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.olostep,
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const payload = await requestJson(
        context,
        {
          url: apiUrl(context.apiHost, '/v1/searches'),
          method: 'POST',
          headers: { Accept: 'application/json', ...bearer(context) },
          body: { query: call.input, limit: Math.min(call.config.maxResults, MAX_SEARCH_LIMIT) }
        },
        OlostepSearchResponseSchema
      )
      return (payload.result.links ?? []).slice(0, call.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.description?.trim() || '',
        url: item.url,
        sourceInput: call.input
      }))
    }
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/scrapes'),
        method: 'POST',
        headers: { Accept: 'application/json', ...bearer(context) },
        body: { url_to_scrape: call.input.trim(), formats: ['markdown'] }
      },
      OlostepScrapeResponseSchema
    )
    const content = payload.result.markdown_content?.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Olostep scrape returned empty content')
    return [{ title: call.input, content, url: call.input, sourceInput: call.input }]
  }
}
