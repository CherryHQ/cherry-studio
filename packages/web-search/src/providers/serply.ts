import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const SerplySearchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      description: z.string().nullish(),
      link: z.string()
    })
  )
})

export const serply: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['serply'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, `/v1/search/q=${encodeURIComponent(call.input)}&num=${call.config.maxResults}`),
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Api-Key': call.credentials?.apiKey || '' }
      },
      SerplySearchResponseSchema
    )
    return payload.results.slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.description?.trim() || '',
      url: item.link,
      sourceInput: call.input
    }))
  }
}
