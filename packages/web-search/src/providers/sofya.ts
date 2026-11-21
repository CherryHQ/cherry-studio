import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const SofyaSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string(),
        content: z.string().nullish(),
        description: z.string().nullish()
      })
    )
    .default([])
})

export const sofya: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['sofya'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/search'),
        method: 'POST',
        headers: bearer(context),
        // "basic" returns each page's readable text in `content`, or the snippet when a page does not load in time.
        body: { query: call.input, max_results: call.config.maxResults, search_depth: 'basic' }
      },
      SofyaSearchResponseSchema
    )
    return payload.results.slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.content?.trim() || item.description?.trim() || '',
      url: item.url,
      sourceInput: call.input
    }))
  }
}
