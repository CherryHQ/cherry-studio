import { JinaReaderResponseSchema, JinaSearchResponseSchema } from '../internal/jinaSchemas'
import { bearer, checkFailure, decode, fail, json, metadata, prepare, resultSet, send } from '../internal/protocol'
import { mergeApiEndpoint } from '../tools/config'
import type { WebSearchProviderModule } from '../types'
export const jinaMirrorCandidates = Object.freeze({
  searchKeywords: Object.freeze(['https://s.jina.ai', 'https://s.jinaai.cn']),
  fetchUrls: Object.freeze(['https://r.jina.ai', 'https://r.jinaai.cn'])
})
export const jina: WebSearchProviderModule = Object.freeze({
  metadata: metadata('jina'),
  async execute(request, transport) {
    const { host, key } = prepare(request, jina.metadata)
    const search = request.capability === 'searchKeywords'
    const input = request.input.trim()
    const data = json(
      await send(request, transport, mergeApiEndpoint(host, search ? encodeURIComponent(input) : input), 'GET', {
        Accept: 'application/json',
        ...bearer(key),
        ...(search ? {} : { 'X-Retain-Images': 'none' })
      })
    )
    checkFailure(data)
    if (search) {
      const payload = decode(JinaSearchResponseSchema, data)
      const items = payload.data || payload.results
      if (!items) return fail()
      return resultSet(
        request,
        items.slice(0, request.config.maxResults).map((item) => ({
          title: item.title?.trim() || '',
          content: item.content?.trim() || item.description?.trim() || '',
          url: item.url || '',
          sourceInput: request.input
        }))
      )
    }
    const payload = decode(JinaReaderResponseSchema, data)
    const page = payload.data || payload
    if (!('content' in page) && !('text' in page)) return fail()
    return resultSet(request, [
      {
        title: page.title?.trim() || input,
        content: page.content?.trim() || page.text?.trim() || '',
        url: page.url || input,
        sourceInput: request.input
      }
    ])
  }
})
