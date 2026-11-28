import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, protocolError, requestJson } from '../protocols/http'
import type { ProtocolContext, WebSearchProviderModule } from '../types'

const BowmarkRunStatusSchema = z.object({ ok: z.boolean(), error: z.string().nullish() })

const BowmarkSearchResponseSchema = BowmarkRunStatusSchema.extend({
  result: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string().nullish(),
            snippet: z.string().nullish(),
            url: z.string()
          })
        )
        .default([])
    })
    .optional()
})

function checkBowmarkError(context: ProtocolContext, value: unknown): void {
  const parsed = BowmarkRunStatusSchema.safeParse(value)
  if (parsed.success && parsed.data.ok) return
  throw protocolError(
    context,
    'provider_error',
    (parsed.success && parsed.data.error) || 'Bowmark reported a failure'
  )
}

export const bowmark: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG['bowmark'],
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const script = `return await bowmark.search.web(${JSON.stringify({
      query: call.input,
      limit: call.config.maxResults
    })})`
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/v1/run'),
        method: 'POST',
        headers: bearer(context),
        body: { script }
      },
      BowmarkSearchResponseSchema,
      (value) => checkBowmarkError(context, value)
    )
    return (payload.result?.results ?? []).slice(0, call.config.maxResults).map((item) => ({
      title: item.title?.trim() || '',
      content: item.snippet?.trim() || '',
      url: item.url,
      sourceInput: call.input
    }))
  }
}
