import { encode } from 'js-base64'

import { checkFailure, decode, isHttp, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { SearxngSearchResponseSchema } from '../internal/searxngSchemas'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const searxng: WebSearchProviderModule = Object.freeze({
  metadata: metadata('searxng'),
  async execute(request, transport) {
    const { host } = prepare(request, searxng.metadata)
    const params = new URLSearchParams({ q: request.input, language: 'auto', format: 'json' })
    if (request.config.engines?.length) params.set('engines', request.config.engines.join(','))
    const headers: Record<string, string> = {}
    const username = request.credentials?.basicAuthUsername
    if (username)
      headers.Authorization = `Basic ${encode(`${username}:${request.credentials?.basicAuthPassword ?? ''}`)}`
    const data = json(await send(request, transport, `${mergeApiEndpoint(host, '/search')}?${params}`, 'GET', headers))
    checkFailure(data)
    const payload = decode(SearxngSearchResponseSchema, data)
    return resultSet(
      request,
      payload.results
        .filter((item) => isHttp(item.url || ''))
        .map((item) => ({
          title: item.title?.trim() ?? '',
          url: item.url || '',
          content: item.content?.trim() || item.snippet?.trim() || '',
          sourceInput: request.input
        }))
    )
  }
})
