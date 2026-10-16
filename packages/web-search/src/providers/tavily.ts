import { bearer, checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { TavilySearchResponseSchema } from '../internal/tavilySchemas'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const tavily: WebSearchProviderModule = Object.freeze({
  metadata: metadata('tavily'),
  async execute(request, transport) {
    const { host, key } = prepare(request, tavily.metadata)
    const text = await send(
      request,
      transport,
      mergeApiEndpoint(host, `/search`),
      'POST',
      { 'Content-Type': 'application/json', ...bearer(key) },
      { query: request.input, max_results: request.config.maxResults }
    )
    const data = json(text)
    checkFailure(data)
    const payload = decode(TavilySearchResponseSchema, data)
    return resultSet(
      request,
      payload.results.slice(0, request.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.content?.trim() || '',
        url: item.url || '',
        sourceInput: request.input
      }))
    )
  }
})
