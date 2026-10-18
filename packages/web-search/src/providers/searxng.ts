import { encode } from 'js-base64'
import * as z from 'zod'

import { WEB_SEARCH_PROVIDER_CATALOG } from '../catalog'
import { runProtocol } from '../execute'
import { apiUrl, protocolError, requestJson } from '../protocols/http'
import type { WebSearchCall, WebSearchCredentials, WebSearchProviderModule, WebSearchTransport } from '../types'
import { isHttpUrl } from '../validation'

const searchSchema = z.object({
  query: z.string().optional(),
  results: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        snippet: z.string().optional(),
        url: z.string().optional()
      })
    )
    .default([])
})
const configSchema = z.object({
  engines: z.array(z.object({ enabled: z.boolean(), categories: z.array(z.string()), name: z.string() }))
})

function basicAuth(credentials?: WebSearchCredentials): Record<string, string> {
  const auth = credentials?.basicAuth
  return auth?.username ? { Authorization: `Basic ${encode(`${auth.username}:${auth.password}`)}` } : {}
}

export async function discoverSearxngEngines(input: {
  config: { apiHost: string }
  credentials?: WebSearchCredentials
  transport: WebSearchTransport
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<string[]> {
  const call: WebSearchCall = {
    providerId: 'searxng',
    capability: 'searchKeywords',
    input: 'config',
    config: { ...input.config, maxResults: 1 },
    credentials: input.credentials,
    signal: input.signal,
    timeoutMs: input.timeoutMs
  }
  return runProtocol(call, input.transport, async (context) => {
    const payload = await requestJson(
      context,
      {
        url: apiUrl(context.apiHost, '/config'),
        method: 'GET',
        headers: basicAuth(input.credentials)
      },
      configSchema
    )
    const engines = payload.engines
      .filter((engine) => engine.enabled && engine.categories.includes('general'))
      .sort((a, b) => Number(b.categories.includes('web')) - Number(a.categories.includes('web')))
      .map((engine) => engine.name)
    if (!engines.length)
      throw protocolError(
        context,
        'no_engines_available',
        'No enabled general web search engines found in Searxng configuration'
      )
    return engines
  })
}

export const searxng: WebSearchProviderModule = {
  metadata: WEB_SEARCH_PROVIDER_CATALOG.searxng,
  async execute(context) {
    const { call } = context
    if (call.capability !== 'searchKeywords') throw new TypeError('Expected keyword search')
    const params = new URLSearchParams({ q: call.input, language: 'auto', format: 'json' })
    const engines = call.config.engines?.map((engine) => engine.trim()).filter(Boolean)
    if (engines?.length) params.set('engines', engines.join(','))
    const payload = await requestJson(
      context,
      { method: 'GET', headers: basicAuth(call.credentials), url: `${apiUrl(context.apiHost, '/search')}?${params}` },
      searchSchema
    )
    return payload.results
      .filter((item) => isHttpUrl(item.url || ''))
      .slice(0, call.config.maxResults)
      .map((item) => ({
        title: item.title?.trim() || '',
        url: item.url || '',
        content: item.content?.trim() || item.snippet?.trim() || '',
        sourceInput: call.input
      }))
  }
}
