import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const DeepSeekSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string(),
        snippet: z.string().optional(),
        summary: z.string().optional()
      })
    )
    .default([])
})

const DeepSeekFetchResponseSchema = z.object({
  title: z.string(),
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
          headers: bearer(context),
          body: { query: call.input.trim(), count: call.config.maxResults }
        },
        DeepSeekSearchResponseSchema
      )
      // `summary` is the query-aware abstract meant for model consumption; `snippet` is the UI teaser.
      return payload.results.map((item) => ({
        title: item.title?.trim() || '',
        content: item.summary?.trim() || item.snippet?.trim() || '',
        url: item.url,
        sourceInput: call.input
      }))
    }
    const url = call.input.trim()
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/tools/fetch'),
        method: 'POST',
        headers: bearer(context),
        body: { url }
      },
      DeepSeekFetchResponseSchema
    )
    const content = payload.content.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'DeepSeek fetch returned empty content')
    return [{ title: payload.title.trim() || url, content, url, sourceInput: call.input }]
  }
}
