import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, checkProviderError, invalidResponse, protocolError, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'
import { WebSearchError } from '../WebSearchError'

const Crawl4AIMarkdownResponseSchema = z.object({
  url: z.string(),
  markdown: z.string(),
  success: z.boolean()
})

const Crawl4AICloudScrapeResponseSchema = z.object({
  ok: z.boolean(),
  markdown: z.string().optional()
})

export const crawl4ai: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.crawl4ai,
  async execute(context) {
    const { call } = context
    const { hostname } = new URL(context.apiHost)
    const cloud = hostname === 'crawl4ai.com' || hostname.endsWith('.crawl4ai.com')
    if (cloud && !call.credentials?.apiKey?.trim()) {
      throw new WebSearchError({
        ...call,
        kind: 'configuration',
        code: 'api_key_missing',
        message: 'Crawl4AI Cloud requires an API key'
      })
    }
    const request = {
      url: apiUrl(context.apiHost, cloud ? '/scrape' : '/md'),
      method: 'POST' as const,
      headers: bearer(context),
      body: cloud ? { url: call.input.trim(), format: 'md' } : { url: call.input.trim(), f: 'fit' }
    }
    const payload = cloud
      ? await requestJson(context, request, Crawl4AICloudScrapeResponseSchema)
      : await requestJson(context, request, Crawl4AIMarkdownResponseSchema, (value) =>
          checkProviderError(context, value, 'success')
        )
    if ('ok' in payload && !payload.ok) throw protocolError(context, 'provider_error', 'Crawl4AI fetch failed')
    const content = payload.markdown?.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Crawl4AI fetch returned empty content')
    const url = 'url' in payload ? payload.url || call.input : call.input
    return [{ title: url, content, url, sourceInput: call.input }]
  }
}
