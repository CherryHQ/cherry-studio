import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const ExaSearchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullable().optional(),
        text: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([]),
  autopromptString: z.string().optional()
})

const ExaContentsResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullable().optional(),
        text: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([])
})

export const exa: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['exa'],
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const payload = await requestJson(
        context,
        {
          url: apiUrl(context.apiHost, '/search'),
          method: 'POST',
          headers: { 'x-api-key': call.credentials?.apiKey || '' },
          body: { query: call.input, numResults: call.config.maxResults, contents: { text: true } }
        },
        ExaSearchResponseSchema
      )
      return payload.results.slice(0, call.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.text?.trim() || '',
        url: item.url || '',
        sourceInput: call.input
      }))
    }
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/contents'),
        method: 'POST',
        headers: { 'x-api-key': call.credentials?.apiKey || '' },
        body: { urls: [call.input.trim()], text: true }
      },
      ExaContentsResponseSchema
    )
    const page = payload.results[0]
    const content = page?.text?.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Exa Contents returned empty content')
    return [
      {
        title: page.title?.trim() || call.input,
        content,
        url: page.url || call.input,
        sourceInput: call.input
      }
    ]
  }
}
