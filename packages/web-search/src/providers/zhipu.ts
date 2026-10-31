import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { requestJson, bearer } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const ZhipuWebSearchResponseSchema = z.object({
  search_result: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        link: z.string().optional()
      })
    )
    .default([])
})

export const zhipu: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['zhipu'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: context.apiHost,
        method: 'POST',
        headers: bearer(context),
        body: { search_query: call.input, search_engine: 'search_std', search_intent: false }
      },
      ZhipuWebSearchResponseSchema
    )
    return payload.search_result.slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.content?.trim() || '',
      url: item.link || '',
      sourceInput: call.input
    }))
  }
}
