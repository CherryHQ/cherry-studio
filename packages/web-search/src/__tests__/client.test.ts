import { describe, expect, it } from 'vitest'

import { createWebSearchClient } from '../client'
import { firecrawl } from '../providers/firecrawl'
import { tavily } from '../providers/tavily'
import type { WebSearchExecuteRequest, WebSearchProviderRegistration, WebSearchTransport } from '../types'
import { clientFor, loopbackServer } from './helpers/loopbackServer'

const search = {
  providerId: 'tavily',
  capability: 'searchKeywords',
  input: 'query',
  config: { maxResults: 2 },
  credentials: { apiKey: 'dummy' }
} as const
const unreachable: WebSearchTransport = {
  request: async () => {
    throw new Error('Must validate before transport')
  }
}
function client(
  providers: readonly WebSearchProviderRegistration[] = [{ provider: tavily, capabilities: ['searchKeywords'] }]
) {
  return createWebSearchClient({ transport: unreachable, providers })
}

describe('client boundary', () => {
  it('rejects unknown and unregistered capabilities without sending requests', async () => {
    const server = await loopbackServer('{}')
    try {
      const active = clientFor(tavily)
      await expect(
        active.execute({
          ...search,
          providerId: 'local-fetch',
          config: { apiHost: server.host, maxResults: 2 }
        } as unknown as WebSearchExecuteRequest)
      ).rejects.toMatchObject({ kind: 'configuration', code: 'provider_unknown' })
      await expect(
        active.execute({ ...search, capability: 'fetchUrls', config: { apiHost: server.host } })
      ).rejects.toMatchObject({ kind: 'configuration', code: 'capability_unsupported' })
      expect(server.requests).toEqual([])
    } finally {
      await server.close()
    }
  })
  it('does not let either caller array mutation enable a capability', async () => {
    const capabilities: ('searchKeywords' | 'fetchUrls')[] = ['searchKeywords']
    const providers: WebSearchProviderRegistration[] = [{ provider: firecrawl, capabilities }]
    const active = client(providers)
    capabilities.push('fetchUrls')
    providers.push({ provider: tavily, capabilities: ['searchKeywords'] })
    await expect(
      active.execute({ providerId: 'firecrawl', capability: 'fetchUrls', input: 'url', config: {} })
    ).rejects.toMatchObject({ code: 'capability_unsupported' })
    await expect(active.execute(search)).rejects.toMatchObject({ code: 'provider_unknown' })
  })
  it('intersects registration with the provider capability list', async () => {
    await expect(
      client([{ provider: tavily, capabilities: ['fetchUrls'] }]).execute({ ...search, capability: 'fetchUrls' })
    ).rejects.toMatchObject({ code: 'capability_unsupported' })
  })
  it('rejects duplicate registrations at construction', () => {
    expect(() =>
      client([
        { provider: tavily, capabilities: [] },
        { provider: tavily, capabilities: [] }
      ])
    ).toThrow('Duplicate provider registration')
  })
  it.each([undefined, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxResults %s',
    async (maxResults) => {
      await expect(
        client().execute({ ...search, config: { maxResults } } as WebSearchExecuteRequest)
      ).rejects.toMatchObject({ kind: 'configuration', code: 'invalid_max_results' })
    }
  )
  it.each([0, -1, NaN, Infinity, 2_147_483_648])('rejects invalid timeout %s', async (timeoutMs) => {
    await expect(client().execute({ ...search, timeoutMs })).rejects.toMatchObject({
      kind: 'configuration',
      code: 'invalid_timeout'
    })
  })
  it.each([undefined, 0.5, 2_147_483_647])('forwards accepted timeouts unchanged: %s', async (timeoutMs) => {
    const observed: unknown[] = []
    const signal = new AbortController().signal
    const active = createWebSearchClient({
      providers: [{ provider: tavily, capabilities: ['searchKeywords'] }],
      transport: {
        async request(request) {
          observed.push([request.timeoutMs, request.signal])
          return {
            status: 200,
            headers: {},
            bodyText: '{"query":"query","request_id":"id","response_time":1,"results":[]}'
          }
        }
      }
    })
    await expect(active.execute({ ...search, signal, timeoutMs })).resolves.toMatchObject({ results: [] })
    expect(observed).toEqual([[timeoutMs, signal]])
  })
  it('checks cancellation on both success and failure paths', async () => {
    for (const failure of [false, true]) {
      const controller = new AbortController()
      const reason = { userAbort: true }
      const active = createWebSearchClient({
        providers: [{ provider: tavily, capabilities: ['searchKeywords'] }],
        transport: {
          async request() {
            controller.abort(reason)
            if (failure) throw new Error('native details')
            return {
              status: 200,
              headers: {},
              bodyText: '{"query":"query","request_id":"id","response_time":1,"results":[]}'
            }
          }
        }
      })
      await expect(active.execute({ ...search, signal: controller.signal })).rejects.toBe(reason)
    }
  })
})

it.each([2_147_483_648, Number.MAX_SAFE_INTEGER])(
  'accepts safe maxResults beyond the timeout range: %s',
  async (maxResults) => {
    const server = await loopbackServer('{"query":"query","request_id":"id","response_time":1,"results":[]}')
    try {
      await expect(
        clientFor(tavily).execute({ ...search, config: { apiHost: server.host, maxResults } })
      ).resolves.toMatchObject({ results: [] })
      expect(server.requests).toHaveLength(1)
    } finally {
      await server.close()
    }
  }
)
