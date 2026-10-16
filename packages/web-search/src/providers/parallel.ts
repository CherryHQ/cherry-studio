import { ParallelSearchResponseSchema } from '../internal/parallelSchemas'
import { checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const parallel: WebSearchProviderModule = Object.freeze({
  metadata: metadata('parallel'),
  async execute(request, transport) {
    const { host, key } = prepare(request, parallel.metadata)
    const text = await send(
      request,
      transport,
      mergeApiEndpoint(host, `/v1/search`),
      'POST',
      { 'Content-Type': 'application/json', ...{ 'x-api-key': key } },
      {
        objective: request.input,
        search_queries: [request.input],
        advanced_settings: { max_results: request.config.maxResults }
      }
    )
    const data = json(text)
    checkFailure(data)
    const payload = decode(ParallelSearchResponseSchema, data)
    return resultSet(
      request,
      payload.results.slice(0, request.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.excerpts
          .map((excerpt) => excerpt.trim())
          .filter(Boolean)
          .join('\n\n'),
        url: item.url,
        sourceInput: request.input
      }))
    )
  }
})
