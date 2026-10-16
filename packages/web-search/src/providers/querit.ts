import { bearer, checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { QueritSearchResponseSchema, QueritContentsResponseSchema } from '../internal/queritSchemas'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const querit: WebSearchProviderModule = Object.freeze({
  metadata: metadata('querit'),
  async execute(request, transport) {
    const { host, key } = prepare(request, querit.metadata)
    const search = request.capability === 'searchKeywords'
    const input = search ? request.input : request.input.trim()
    const body = search
      ? {
          query: input,
          count: request.config.maxResults,
          ...(request.config.excludeDomains?.length
            ? { filters: { sites: { exclude: request.config.excludeDomains } } }
            : {})
        }
      : { urls: [input], format: 'markdown', extrasMeta: true }
    const data = json(
      await send(
        request,
        transport,
        mergeApiEndpoint(host, search ? '/v1/search' : '/v1/contents'),
        'POST',
        { 'Content-Type': 'application/json', ...bearer(key) },
        body
      )
    )
    checkFailure(data)
    if (search) {
      const payload = decode(QueritSearchResponseSchema, data)
      return resultSet(
        request,
        payload.results.result.flatMap((item) => {
          const url = item.url?.trim()
          return url
            ? [
                {
                  title: item.title?.trim() || item.site_name?.trim() || item.snippet?.trim() || url,
                  url,
                  content: item.snippet || '',
                  sourceInput: request.input
                }
              ]
            : []
        })
      )
    }
    const page = decode(QueritContentsResponseSchema, data).results[0]
    return resultSet(
      request,
      page
        ? [
            {
              title: page.extrasMeta?.title?.trim() || input,
              content: page.content?.trim() || '',
              url: page.url || input,
              sourceInput: request.input
            }
          ]
        : []
    )
  }
})
