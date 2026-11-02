import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const SearchApiSearchResponseSchema = z.object({
  organic_results: z
    .array(
      z.object({
        title: z.string().nullish(),
        snippet: z.string().nullish(),
        link: z.string()
      })
    )
    .default([])
})

export const searchapi: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['searchapi'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const params = new URLSearchParams({ engine: 'google', q: call.input })
    const payload = await requestJson(
      context,
      { url: `${apiUrl(context.apiHost, '/api/v1/search')}?${params}`, method: 'GET', headers: bearer(context) },
      SearchApiSearchResponseSchema
    )
    return payload.organic_results.slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.snippet?.trim() || '',
      url: item.link,
      sourceInput: call.input
    }))
  }
}
