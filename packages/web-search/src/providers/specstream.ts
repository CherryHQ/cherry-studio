import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

// The Search API reads a question of 1 to 2,000 characters and has no result-count parameter.
const MAX_SEARCH_QUERY_LENGTH = 2000

const searchSchema = z.looseObject({
  data: z.looseObject({
    sources: z
      .array(
        z.looseObject({
          title: z.string().nullish(),
          url: z.string(),
          snippet: z.string().nullish()
        })
      )
      .default([]),
    passages: z.array(z.looseObject({ url: z.string(), text: z.string() })).default([])
  })
})

const extractSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      url: z.string(),
      status: z.string(),
      title: z.string().nullish(),
      text: z.string().nullish()
    })
  )
})

export const specstream: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.specstream,
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const params = new URLSearchParams({
        q: Array.from(call.input.trim()).slice(0, MAX_SEARCH_QUERY_LENGTH).join(''),
        passages: 'true'
      })
      const payload = await requestJson(
        context,
        {
          url: `${apiUrl(context.apiHost, '/v1/web-search')}?${params}`,
          method: 'GET',
          headers: { Accept: 'application/json', ...bearer(context) }
        },
        searchSchema
      )
      const passages = new Map<string, string[]>()
      for (const passage of payload.data.passages) {
        passages.set(passage.url, [...(passages.get(passage.url) ?? []), passage.text.trim()])
      }
      return payload.data.sources.slice(0, call.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: passages.get(item.url)?.join('\n\n') || item.snippet?.trim() || '',
        url: item.url,
        sourceInput: call.input
      }))
    }
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/extract'),
        method: 'POST',
        headers: { Accept: 'application/json', ...bearer(context) },
        body: { urls: [call.input.trim()], format: 'markdown' }
      },
      extractSchema
    )
    const page = payload.results[0]
    if (!page) throw invalidResponse(context, 'empty_results', 'SpecStream Extract returned no result')
    const content = page.text?.trim()
    if (page.status !== 'ok' || !content) {
      throw invalidResponse(context, `extract_${page.status}`, `SpecStream Extract could not read the page (${page.status})`)
    }
    return [{ title: page.title?.trim() || call.input, content, url: call.input, sourceInput: call.input }]
  }
}
