import { checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { SerplySearchResponseSchema } from '../internal/serplySchemas'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const serply: WebSearchProviderModule = Object.freeze({
  metadata: metadata('serply'),
  async execute(request, transport) {
    const { host, key } = prepare(request, serply.metadata)
    const text = await send(
      request,
      transport,
      mergeApiEndpoint(host, `/v1/search/q=${encodeURIComponent(request.input)}&num=${request.config.maxResults}`),
      'GET',
      { ...{ Accept: 'application/json', 'X-Api-Key': key } },
      undefined
    )
    const data = json(text)
    checkFailure(data)
    const payload = decode(SerplySearchResponseSchema, data)
    return resultSet(
      request,
      payload.results.slice(0, request.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.description?.trim() || '',
        url: item.link,
        sourceInput: request.input
      }))
    )
  }
})
