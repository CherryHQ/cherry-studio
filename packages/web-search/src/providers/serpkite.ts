import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const SerpKiteSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        snippet: z.string().nullish(),
        link: z.string()
      })
    )
    .nullish()
})

export const serpkite: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.serpkite,
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const params = new URLSearchParams({ q: call.input, num: String(call.config.maxResults) })
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, `/v1/search?${params.toString()}`),
        method: 'GET',
        headers: { Accept: 'application/json', ...bearer(context) }
      },
      SerpKiteSearchResponseSchema
    )
    return (payload.results ?? []).slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.snippet?.trim() || '',
      url: item.link,
      sourceInput: call.input
    }))
  }
}
