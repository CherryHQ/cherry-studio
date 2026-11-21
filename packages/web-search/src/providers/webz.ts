import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

/**
 * Webz.io's parameter reference documents a maximum `k` of 100, but the errors
 * reference returns HTTP 422 above 50. Stay within the lower, verified contract.
 */
const MAX_RESULTS_PER_SEARCH = 50

const WebzNewsSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        article: z.object({
          title: z.string().nullish(),
          url: z.string().nullish()
        }),
        chunk: z.object({ text: z.string().nullish() })
      })
    )
    .default([])
})

export const webz: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['webz'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/api/news/context'),
        method: 'POST',
        headers: bearer(context),
        // Only the documented minimum: the natural-language query and the
        // result count. Filters and score thresholds stay at Webz.io defaults.
        body: { query: call.input, k: Math.min(call.config.maxResults, MAX_RESULTS_PER_SEARCH) }
      },
      WebzNewsSearchResponseSchema
    )
    return payload.results
      .flatMap((item) => {
        // A result without a URL cannot be opened, so it is dropped.
        const url = item.article.url
        if (!url) return []
        return [
          {
            title: item.article.title?.trim() || '',
            content: item.chunk.text?.trim() || '',
            url,
            sourceInput: call.input
          }
        ]
      })
      .slice(0, call.config.maxResults)
  }
}
