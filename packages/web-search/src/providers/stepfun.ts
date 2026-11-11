import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const searchSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      title: z.string(),
      url: z.string(),
      snippet: z.string().optional(),
      content: z.string().optional()
    })
  )
})

export const stepfun: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.stepfun,
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const url = new URL(apiUrl(context.apiHost, 'search'))
    url.pathname = url.pathname.replace(/\/(?:v1\/)?search$/, '/v1/search')
    const payload = await requestJson(
      context,
      {
        url: url.toString(),
        method: 'POST',
        headers: bearer(context),
        body: { query: call.input, n: Math.min(call.config.maxResults, 20) }
      },
      searchSchema
    )
    return payload.results.slice(0, call.config.maxResults).map((item) => ({
      title: item.title,
      url: item.url,
      content: item.content || item.snippet || '',
      sourceInput: call.input
    }))
  }
}
