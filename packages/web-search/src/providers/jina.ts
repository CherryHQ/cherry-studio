import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { bearer, invalidResponse, requestJson } from '../protocols/http'
import type { WebSearchProviderModule } from '../types'

export const JINA_MIRROR_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  'https://s.jina.ai': 'https://s.jinaai.cn',
  'https://r.jina.ai': 'https://r.jinaai.cn'
})

export function getJinaHostCandidates(apiHost: string, region: 'global' | 'mainland-china'): readonly string[] {
  const mirror = JINA_MIRROR_HOSTS[apiHost]
  return mirror ? (region === 'mainland-china' ? [mirror, apiHost] : [apiHost, mirror]) : [apiHost]
}

const itemSchema = z.looseObject({
  title: z.string().optional(),
  content: z.string().optional(),
  text: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional()
})
const searchSchema = z.looseObject({
  data: z.array(itemSchema).optional(),
  results: z.array(itemSchema).optional()
})
const readerSchema = itemSchema.extend({ data: itemSchema.optional() })

export const jina: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.jina,
  async execute(context) {
    const { call } = context
    const base = context.apiHost.replace(/\/+$/, '')
    if (call.capability === 'searchKeywords') {
      const payload = await requestJson(
        context,
        {
          url: `${base}/${encodeURIComponent(call.input.trim())}`,
          method: 'GET',
          headers: { Accept: 'application/json', ...bearer(context) }
        },
        searchSchema
      )
      return (payload.data || payload.results || []).slice(0, call.config.maxResults).map((item) => ({
        title: item.title?.trim() || '',
        content: item.content?.trim() || item.description?.trim() || '',
        url: item.url || '',
        sourceInput: call.input
      }))
    }
    const payload = await requestJson(
      context,
      {
        url: `${base}/${call.input.trim()}`,
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Retain-Images': 'none', ...bearer(context) }
      },
      readerSchema
    )
    const data = payload.data || payload
    const content = data.content?.trim() || data.text?.trim()
    if (!content) throw invalidResponse(context, 'empty_content', 'Jina Reader returned empty content')
    return [{ title: data.title?.trim() || call.input, content, url: data.url || call.input, sourceInput: call.input }]
  }
}
