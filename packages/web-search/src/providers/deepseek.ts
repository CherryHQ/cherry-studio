import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

// The Search API caps the query at 128 characters and count at 50 results.
const MAX_SEARCH_QUERY_LENGTH = 128
const MAX_SEARCH_COUNT = 50

const searchResultSchema = z.looseObject({
  title: z.string(),
  url: z.string(),
  snippet: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional()
})
const searchSchema = z.looseObject({ results: z.array(searchResultSchema) })
const fetchSchema = z.looseObject({
  title: z.string().optional(),
  content: z.string()
})

export const deepseek: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.deepseek,
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const payload = await requestJson(
        context,
        {
          url: apiUrl(context.apiHost, '/v1/tools/search'),
          method: 'POST',
          headers: { Accept: 'application/json', ...bearer(context) },
          body: {
            query: Array.from(call.input.trim()).slice(0, MAX_SEARCH_QUERY_LENGTH).join(''),
            count: Math.min(Math.max(call.config.maxResults, 1), MAX_SEARCH_COUNT)
          }
        },
        searchSchema
      )
      return payload.results.slice(0, call.config.maxResults).map((item) => ({
        title: item.title.trim(),
        url: item.url,
        // `summary` is the model-oriented long digest; `snippet` is the short UI blurb.
        content: item.content || item.summary || item.snippet || '',
        sourceInput: call.input
      }))
    }
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/tools/fetch'),
        method: 'POST',
        headers: { Accept: 'application/json', ...bearer(context) },
        body: { url: call.input.trim() }
      },
      fetchSchema
    )
    const content = payload.content.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'DeepSeek Fetch returned empty content')
    return [{ title: payload.title?.trim() || call.input, content, url: call.input, sourceInput: call.input }]
  }
}
