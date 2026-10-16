import { FirecrawlSearchResponseSchema, FirecrawlScrapeResponseSchema } from '../internal/firecrawlSchemas'
import { bearer, checkFailure, decode, fail, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const firecrawl: WebSearchProviderModule = Object.freeze({
  metadata: metadata('firecrawl'),
  async execute(request, transport) {
    const { host, key } = prepare(request, firecrawl.metadata)
    const search = request.capability === 'searchKeywords'
    const input = search ? request.input : request.input.trim()
    const body = search
      ? { query: input, limit: request.config.maxResults, scrapeOptions: { formats: ['markdown'] } }
      : { url: input, formats: ['markdown'] }
    const data = json(
      await send(
        request,
        transport,
        mergeApiEndpoint(host, search ? '/v2/search' : '/v2/scrape'),
        'POST',
        { 'Content-Type': 'application/json', ...bearer(key) },
        body
      )
    )
    checkFailure(data)
    if (search) {
      const payload = decode(FirecrawlSearchResponseSchema, data)
      if (!payload.data?.web) return fail()
      return resultSet(
        request,
        payload.data.web.slice(0, request.config.maxResults).map((item) => ({
          title: item.title?.trim() || '',
          content: item.markdown?.trim() || item.description?.trim() || '',
          url: item.url || '',
          sourceInput: request.input
        }))
      )
    }
    const payload = decode(FirecrawlScrapeResponseSchema, data)
    if (!payload.data) return fail()
    const page = payload.data
    const title = Array.isArray(page.metadata?.title) ? page.metadata.title[0] : page.metadata?.title
    return resultSet(request, [
      {
        title: title?.trim() || input,
        content: page.markdown?.trim() || '',
        url: page.metadata?.sourceURL || input,
        sourceInput: request.input
      }
    ])
  }
})
