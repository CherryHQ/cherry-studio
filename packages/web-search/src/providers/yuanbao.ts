import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, invalidResponse, protocolError, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const YuanbaoResponseSchema = z.object({
  Response: z.object({
    Pages: z.array(z.string()).optional(),
    Error: z.object({ Code: z.string(), Message: z.string() }).optional(),
    RequestId: z.string().optional()
  })
})

const YuanbaoPageSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string().nullish(),
  passage: z.string().nullish()
})

const YuanbaoDomainSchema = z.hostname()

export const yuanbao: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.yuanbao,
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const excludeDomains = [
      ...new Set(
        (call.config.excludeDomains ?? [])
          .map((domain) => domain.trim().toLowerCase())
          .filter((domain) => YuanbaoDomainSchema.safeParse(domain).success)
      )
    ].slice(0, 5)
    const { Response: response } = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/SearchPro'),
        method: 'POST',
        headers: bearer(context),
        body: {
          Query: call.input,
          ...(call.config.useDefaultResultCount
            ? {}
            : { Cnt: Math.min(50, Math.ceil(call.config.maxResults / 10) * 10) }),
          ...(excludeDomains.length ? { Site: `exclude:${excludeDomains.join('|')}` } : {})
        }
      },
      YuanbaoResponseSchema
    )
    if (response.Error) {
      throw protocolError(
        context,
        'provider_error',
        `Yuanbao search failed: ${response.Error.Code}: ${response.Error.Message}`,
        response.Error.Code,
        response.RequestId
      )
    }
    if (!response.Pages) throw invalidResponse(context, 'schema_mismatch', 'Yuanbao response is missing Pages')

    return response.Pages.map((page) => {
      let decoded: unknown
      try {
        decoded = JSON.parse(page)
      } catch {
        throw invalidResponse(context, 'invalid_json', 'Yuanbao returned invalid page JSON')
      }
      const parsed = YuanbaoPageSchema.safeParse(decoded)
      if (!parsed.success) throw invalidResponse(context, 'schema_mismatch', 'Yuanbao page validation failed')
      return {
        title: parsed.data.title,
        url: parsed.data.url,
        content: parsed.data.content || parsed.data.passage || '',
        sourceInput: call.input
      }
    }).slice(0, call.config.maxResults)
  }
}
