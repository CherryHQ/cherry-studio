import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, requestJson, bearer, checkProviderError } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const BochaSearchResponseSchema = z.object({
  code: z.number(),
  msg: z.string().nullable(),
  data: z.object({
    queryContext: z.object({
      originalQuery: z.string()
    }),
    webPages: z.object({
      value: z.array(
        z.object({
          name: z.string(),
          summary: z.string().nullable().optional(),
          snippet: z.string().nullable().optional(),
          url: z.string()
        })
      )
    })
  })
})

export const bocha: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['bocha'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/web-search'),
        method: 'POST',
        headers: bearer(context),
        body: {
          query: call.input,
          count: call.config.maxResults,
          summary: true,
          ...(call.config.excludeDomains === undefined ? {} : { exclude: call.config.excludeDomains.join(',') })
        }
      },
      BochaSearchResponseSchema,
      (value) => checkProviderError(context, value, 'code')
    )
    return payload.data.webPages.value.map((item) => ({
      title: item.name,
      content: item.summary || item.snippet || '',
      url: item.url,
      sourceInput: call.input
    }))
  }
}
