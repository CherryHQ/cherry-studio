import { ExaSearchResponseSchema } from '../internal/exaSchemas'
import { checkFailure, decode, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const exa: WebSearchProviderModule = Object.freeze({
  metadata: metadata('exa'),
  async execute(request, transport) {
    const { host, key } = prepare(request, exa.metadata)
    const text = await send(
      request,
      transport,
      mergeApiEndpoint(host, `/search`),
      'POST',
      { 'Content-Type': 'application/json', ...{ 'x-api-key': key } },
      { query: request.input, numResults: request.config.maxResults, contents: { text: true } }
    )
    const data = json(text)
    checkFailure(data)
    const payload = decode(ExaSearchResponseSchema, data)
    return resultSet(
      request,
      payload.results.slice(0, request.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.text?.trim() || '',
        url: item.url || '',
        sourceInput: request.input
      }))
    )
  }
})
