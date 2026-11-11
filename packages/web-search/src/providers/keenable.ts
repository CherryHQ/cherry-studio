import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, invalidResponse, requestJson } from '../protocols/http'
import type { ProtocolContext, WebSearchProviderModule } from '../types'

// The Search API accepts 1-50 results per request.
const MAX_SEARCH_COUNT = 50

const searchSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      title: z.string().nullish(),
      url: z.string(),
      snippet: z.string().nullish()
    })
  )
})
const fetchSchema = z.looseObject({
  title: z.string().nullish(),
  content: z.string().nullish()
})

// Without a key, calls go to the public endpoints, which require an app name header.
function endpoint(context: ProtocolContext, path: string): { path: string; headers: Record<string, string> } {
  const key = context.call.credentials?.apiKey
  return {
    path: key ? path : `${path}/public`,
    headers: { Accept: 'application/json', 'X-Keenable-Title': 'Cherry Studio', ...(key ? { 'X-API-Key': key } : {}) }
  }
}

export const keenable: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.keenable,
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const { path, headers } = endpoint(context, '/v1/search')
      const payload = await requestJson(
        context,
        {
          url: apiUrl(context.apiHost, path),
          method: 'POST',
          headers,
          body: { query: call.input, max_results: Math.min(call.config.maxResults, MAX_SEARCH_COUNT) }
        },
        searchSchema
      )
      return payload.results.slice(0, call.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.snippet?.trim() || '',
        url: item.url,
        sourceInput: call.input
      }))
    }
    const { path, headers } = endpoint(context, '/v1/fetch')
    const payload = await requestJson(
      context,
      {
        url: `${apiUrl(context.apiHost, path)}?${new URLSearchParams({ url: call.input.trim() })}`,
        method: 'GET',
        headers
      },
      fetchSchema
    )
    const content = payload.content?.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Keenable Fetch returned empty content')
    return [{ title: payload.title?.trim() || call.input, content, url: call.input, sourceInput: call.input }]
  }
}
