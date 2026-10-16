import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { apiUrl, bearer, checkProviderError, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

const Crawl4AIMarkdownResponseSchema = z.object({
  url: z.string(),
  markdown: z.string(),
  success: z.boolean()
})

export const crawl4ai: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.crawl4ai,
  async execute(context) {
    const { call } = context
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/md'),
        method: 'POST',
        headers: bearer(context),
        body: { url: call.input.trim(), f: 'fit' }
      },
      Crawl4AIMarkdownResponseSchema,
      (value) => checkProviderError(context, value, 'success')
    )
    const content = payload.markdown.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Crawl4AI fetch returned empty content')
    return [{ title: payload.url || call.input, content, url: payload.url || call.input, sourceInput: call.input }]
  }
}
