import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, checkProviderError, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const QueritSearchResponseSchema = z.object({
  error_code: z.number(),
  error_msg: z.string(),
  query_context: z.object({
    query: z.string()
  }),
  results: z.object({
    result: z
      .array(
        z.looseObject({
          title: z.string().optional(),
          snippet: z.string().optional(),
          url: z.string().optional(),
          site_name: z.string().optional()
        })
      )
      .default([])
  })
})

const QueritContentsResponseSchema = z.object({
  error_code: z.number(),
  error_msg: z.string(),
  results: z
    .array(
      z.object({
        url: z.string().optional(),
        content: z.string().optional(),
        extrasMeta: z
          .looseObject({
            title: z.string().optional()
          })
          .optional()
      })
    )
    .default([])
})

export const querit: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.querit,
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const payload = await requestJson(
        context,
        {
          url: apiUrl(context.apiHost, '/v1/search'),
          method: 'POST',
          headers: bearer(context),
          body: {
            query: call.input,
            count: call.config.maxResults,
            ...(call.config.excludeDomains?.length
              ? { filters: { sites: { exclude: call.config.excludeDomains } } }
              : {})
          }
        },
        QueritSearchResponseSchema,
        (value) => checkProviderError(context, value, 'error_code')
      )
      return payload.results.result.flatMap((item) => {
        const url = item.url?.trim()
        return url
          ? [
              {
                title: item.title?.trim() || item.site_name?.trim() || item.snippet?.trim() || url,
                content: item.snippet || '',
                url,
                sourceInput: call.input
              }
            ]
          : []
      })
    }
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/contents'),
        method: 'POST',
        headers: bearer(context),
        body: { urls: [call.input.trim()], format: 'markdown', extrasMeta: true }
      },
      QueritContentsResponseSchema,
      (value) => checkProviderError(context, value, 'error_code')
    )
    const page = payload.results[0]
    const content = page?.content?.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Querit contents returned empty content')
    return [
      {
        title: page.extrasMeta?.title?.trim() || call.input,
        content,
        url: page.url || call.input,
        sourceInput: call.input
      }
    ]
  }
}
