import { BochaSearchResponseSchema } from '../internal/bochaSchemas'
import { bearer, checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const bocha: WebSearchProviderModule = Object.freeze({
  metadata: metadata('bocha'),
  async execute(request, transport) {
    const { host, key } = prepare(request, bocha.metadata)
    const text = await send(
      request,
      transport,
      mergeApiEndpoint(host, `/v1/web-search`),
      'POST',
      { 'Content-Type': 'application/json', ...bearer(key) },
      {
        query: request.input,
        count: request.config.maxResults,
        exclude: (request.config.excludeDomains ?? []).join(','),
        summary: true
      }
    )
    const data = json(text)
    checkFailure(data)
    const payload = decode(BochaSearchResponseSchema, data)
    return resultSet(
      request,
      payload.data.webPages.value.map((item) => ({
        title: item.name,
        content: item.summary || item.snippet || '',
        url: item.url,
        sourceInput: request.input
      }))
    )
  }
})
