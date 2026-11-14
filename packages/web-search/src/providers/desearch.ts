import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const DesearchWebSearchResponseSchema = z.object({
  data: z
    .array(
      z.object({
        title: z.string().nullish(),
        snippet: z.string().nullish(),
        link: z.string()
      })
    )
    .default([])
})

export const desearch: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['desearch'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: `${apiUrl(context.apiHost, '/web')}?query=${encodeURIComponent(call.input)}`,
        method: 'GET',
        // Desearch expects the raw key, without a Bearer prefix.
        headers: { Accept: 'application/json', Authorization: call.credentials?.apiKey || '' }
      },
      DesearchWebSearchResponseSchema
    )
    return payload.data.slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.snippet?.trim() || '',
      url: item.link,
      sourceInput: call.input
    }))
  }
}
