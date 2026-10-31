import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const ParallelSearchResponseSchema = z.object({
  search_id: z.string(),
  session_id: z.string(),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      excerpts: z.array(z.string())
    })
  )
})

export const parallel: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['parallel'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/search'),
        method: 'POST',
        headers: { 'x-api-key': call.credentials?.apiKey || '' },
        body: {
          objective: call.input,
          search_queries: [call.input],
          advanced_settings: { max_results: call.config.maxResults }
        }
      },
      ParallelSearchResponseSchema
    )
    return payload.results.slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.excerpts
        .map((excerpt) => excerpt.trim())
        .filter(Boolean)
        .join('\n\n'),
      url: item.url,
      sourceInput: call.input
    }))
  }
}
