import { Crawl4AIMarkdownResponseSchema } from '../internal/crawl4aiSchemas'
import { bearer, checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const crawl4ai: WebSearchProviderModule = Object.freeze({
  metadata: metadata('crawl4ai'),
  async execute(request, transport) {
    const { host, key } = prepare(request, crawl4ai.metadata)
    const input = request.input.trim()
    const data = json(
      await send(
        request,
        transport,
        mergeApiEndpoint(host, '/md'),
        'POST',
        { 'Content-Type': 'application/json', ...bearer(key) },
        { url: input, f: 'fit' }
      )
    )
    checkFailure(data)
    const payload = decode(Crawl4AIMarkdownResponseSchema, data)
    return resultSet(request, [
      {
        title: payload.url || input,
        url: payload.url || input,
        content: payload.markdown.trim(),
        sourceInput: request.input
      }
    ])
  }
})
