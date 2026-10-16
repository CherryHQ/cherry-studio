import { bearer, checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { ZhipuWebSearchResponseSchema } from '../internal/zhipuSchemas'
import type { WebSearchProviderModule } from '../types'
export const zhipu: WebSearchProviderModule = Object.freeze({
  metadata: metadata('zhipu'),
  async execute(request, transport) {
    const { host, key } = prepare(request, zhipu.metadata)
    const text = await send(
      request,
      transport,
      host,
      'POST',
      { 'Content-Type': 'application/json', ...bearer(key) },
      { search_query: request.input, search_engine: 'search_std', search_intent: false }
    )
    const data = json(text)
    checkFailure(data)
    const payload = decode(ZhipuWebSearchResponseSchema, data)
    return resultSet(
      request,
      payload.search_result.slice(0, request.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.content?.trim() || '',
        url: item.link || '',
        sourceInput: request.input
      }))
    )
  }
})
