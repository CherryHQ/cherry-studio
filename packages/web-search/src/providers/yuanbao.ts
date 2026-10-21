import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, invalidResponse, protocolError, requestJson } from '../protocols/http'
import type { ProtocolContext, WebSearchProviderModule } from '../types'
import { WebSearchError } from '../WebSearchError'

const YuanbaoResponseSchema = z.looseObject({
  Response: z.looseObject({ Pages: z.array(z.string()) })
})
const YuanbaoPageSchema = z.looseObject({
  title: z.string(),
  url: z.string(),
  content: z.string().optional(),
  passage: z.string().optional()
})
const YuanbaoErrorEnvelopeSchema = z.looseObject({ Response: z.looseObject({}) })
const YuanbaoErrorSchema = z.looseObject({ Code: z.string().min(1), Message: z.string() })

function checkYuanbaoError(context: ProtocolContext, payload: unknown, status?: number): void {
  const envelope = YuanbaoErrorEnvelopeSchema.safeParse(payload)
  if (!envelope.success || !Object.prototype.hasOwnProperty.call(envelope.data.Response, 'Error')) return
  const parsed = YuanbaoErrorSchema.safeParse(envelope.data.Response.Error)
  if (!parsed.success)
    throw invalidResponse(context, 'yuanbao_invalid_error', 'Yuanbao returned an invalid Error object')
  const { Code, Message } = parsed.data
  const error = protocolError(context, 'provider_error', Message || `Yuanbao reported ${Code}`, Code)
  throw status === undefined ? error : new WebSearchError({ ...error.toJSON(), status })
}

export const yuanbao: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.yuanbao,
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const payload = await requestJson(
      {
        ...context,
        transport: {
          async request(request) {
            const response = await context.transport.request(request)
            if (response.status < 200 || response.status >= 300) {
              let decoded: unknown
              try {
                decoded = JSON.parse(response.bodyText)
              } catch {
                return response
              }
              checkYuanbaoError(context, decoded, response.status)
            }
            return response
          }
        }
      },
      {
        url: apiUrl(context.apiHost, '/SearchPro'),
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', ...bearer(context) },
        body: { Query: call.input }
      },
      YuanbaoResponseSchema,
      (value) => checkYuanbaoError(context, value)
    )
    const pages = payload.Response.Pages.map((page) => {
      let decoded: unknown
      try {
        decoded = JSON.parse(page)
      } catch {
        throw invalidResponse(context, 'yuanbao_page_invalid_json', 'Yuanbao returned invalid page JSON')
      }
      const parsed = YuanbaoPageSchema.safeParse(decoded)
      if (!parsed.success)
        throw invalidResponse(context, 'yuanbao_page_schema_mismatch', 'Yuanbao returned an invalid page object')
      return parsed.data
    })
    return pages.slice(0, call.config.maxResults).map((page) => ({
      title: page.title.trim(),
      url: page.url,
      content: page.content || page.passage || '',
      sourceInput: call.input
    }))
  }
}
