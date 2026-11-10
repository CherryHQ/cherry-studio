import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, requestJson, bearer } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const TavilySearchResponseSchema = z.object({
  query: z.string(),
  request_id: z.string(),
  response_time: z.union([z.number(), z.string()]),
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([])
})

export const tavily: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['tavily'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/search'),
        method: 'POST',
        headers: bearer(context),
        body: { query: call.input, max_results: call.config.maxResults }
      },
      TavilySearchResponseSchema
    )
    return payload.results.slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.content?.trim() || '',
      url: item.url || '',
      sourceInput: call.input
    }))
  }
}
