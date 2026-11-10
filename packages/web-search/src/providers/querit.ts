import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, checkProviderError, invalidResponse, protocolError, requestJson } from '../protocols/http'
import type { ProtocolContext, WebSearchProviderModule } from '../types'

const QueritStatusSchema = z.object({ error_code: z.coerce.number() })

const QueritSearchResponseSchema = QueritStatusSchema.extend({
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

const QueritContentsResponseSchema = QueritStatusSchema.extend({
  error_msg: z.string(),
  results: z
    .array(
      z.object({
        id: z.string().optional(),
        url: z.string().optional(),
        content: z.string().optional(),
        extrasMeta: z
          .looseObject({
            title: z.string().optional()
          })
          .optional()
      })
    )
    .default([]),
  statuses: z.array(z.object({ id: z.string().optional(), status: z.enum(['success', 'failed']) })).optional()
})

function queritUrl(apiHost: string, endpoint: 'search' | 'contents'): string {
  const url = new URL(apiUrl(apiHost, endpoint))
  url.pathname = url.pathname.replace(/\/(?:v1\/)?(search|contents)$/, '/v1/$1')
  return url.toString()
}

function checkQueritError(context: ProtocolContext, value: unknown): void {
  const parsed = QueritStatusSchema.safeParse(value)
  if (parsed.success && parsed.data.error_code === 200) return
  checkProviderError(context, value, 'error_code')
}

export const querit: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.querit,
  async execute(context) {
    const { call } = context
    if (call.capability === 'searchKeywords') {
      const payload = await requestJson(
        context,
        {
          url: queritUrl(context.apiHost, 'search'),
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
        (value) => checkQueritError(context, value)
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
        url: queritUrl(context.apiHost, 'contents'),
        method: 'POST',
        headers: bearer(context),
        body: { urls: [call.input.trim()], format: 'markdown', extrasMeta: true }
      },
      QueritContentsResponseSchema,
      (value) => checkQueritError(context, value)
    )
    const page = payload.results[0]
    const statuses = payload.statuses ?? []
    const status =
      statuses.find((entry) => page?.id !== undefined && entry.id === page.id) ??
      (statuses.length === 1 && (page?.id === undefined || statuses[0].id === undefined) ? statuses[0] : undefined)
    if (status?.status === 'failed') {
      throw protocolError(context, 'page_fetch_failed', `Querit could not fetch page content for ${call.input.trim()}`)
    }
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
