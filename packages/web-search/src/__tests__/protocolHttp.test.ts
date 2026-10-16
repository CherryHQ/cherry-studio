import { expect, it } from 'vitest'

import { createWebSearchClient } from '../client'
import { WebSearchError } from '../errors'
import { bocha } from '../providers/bocha'
import { crawl4ai } from '../providers/crawl4ai'
import { exa } from '../providers/exa'
import { firecrawl } from '../providers/firecrawl'
import { jina } from '../providers/jina'
import { parallel } from '../providers/parallel'
import { querit } from '../providers/querit'
import { searxng } from '../providers/searxng'
import { serply } from '../providers/serply'
import { tavily } from '../providers/tavily'
import { zhipu } from '../providers/zhipu'
import type { WebSearchProviderModule, WebSearchResult } from '../types'
import { clientFor, fixture, httpTransport, loopbackServer } from './helpers/loopbackServer'

const input = 'a/b c'
const cases: {
  provider: WebSearchProviderModule
  fixture: string
  path: string
  body?: string
  auth?: [string, string]
  results: Omit<WebSearchResult, 'sourceInput'>[]
}[] = [
  {
    provider: zhipu,
    fixture: 'zhipu-response.json',
    path: '',
    body: '{"search_query":"a/b c","search_engine":"search_std","search_intent":false}',
    auth: ['authorization', 'Bearer dummy'],
    results: [{ title: 'Zhipu Title', content: 'Zhipu Content', url: 'https://zhipu.example/result' }]
  },
  {
    provider: tavily,
    fixture: 'tavily-response.json',
    path: '/search',
    body: '{"query":"a/b c","max_results":2}',
    auth: ['authorization', 'Bearer dummy'],
    results: [{ title: 'Tavily Title', content: 'Tavily Content', url: 'https://tavily.example/result' }]
  },
  {
    provider: exa,
    fixture: 'exa-response.json',
    path: '/search',
    body: '{"query":"a/b c","numResults":2,"contents":{"text":true}}',
    auth: ['x-api-key', 'dummy'],
    results: [{ title: 'Exa Title', content: 'Exa Content', url: 'https://exa.example/result' }]
  },
  {
    provider: bocha,
    fixture: 'bocha-response.json',
    path: '/v1/web-search',
    body: '{"query":"a/b c","count":2,"exclude":"blocked.test,other.test","summary":true}',
    auth: ['authorization', 'Bearer dummy'],
    results: [
      { title: 'Bocha Title', content: 'Bocha Content', url: 'https://bocha.example/result' },
      { title: 'Bocha Summary Title', content: 'Bocha Summary Content', url: 'https://bocha.example/summary-result' },
      {
        title: 'Bocha Preferred Summary Title',
        content: 'Bocha Preferred Summary Content',
        url: 'https://bocha.example/preferred-summary-result'
      },
      { title: 'Bocha Empty Content Title', content: '', url: 'https://bocha.example/empty-content-result' }
    ]
  },
  {
    provider: querit,
    fixture: 'querit-response.json',
    path: '/v1/search',
    body: '{"query":"a/b c","count":2,"filters":{"sites":{"exclude":["blocked.test","other.test"]}}}',
    auth: ['authorization', 'Bearer dummy'],
    results: [{ title: 'Querit Title', content: 'Querit Content', url: 'https://querit.example/result' }]
  },
  {
    provider: parallel,
    fixture: 'parallel-response.json',
    path: '/v1/search',
    body: '{"objective":"a/b c","search_queries":["a/b c"],"advanced_settings":{"max_results":2}}',
    auth: ['x-api-key', 'dummy'],
    results: [
      { title: 'Parallel Title', content: 'First excerpt.\n\nSecond excerpt.', url: 'https://parallel.example/result' }
    ]
  },
  {
    provider: serply,
    fixture: 'serply-response.json',
    path: '/v1/search/q=a%2Fb%20c&num=2',
    auth: ['x-api-key', 'dummy'],
    results: [{ title: 'Serply Title', content: 'Serply Description', url: 'https://serply.example/result' }]
  },
  {
    provider: searxng,
    fixture: 'searxng-search-response.json',
    path: '/search?q=a%2Fb+c&language=auto&format=json&engines=google%2Cbing',
    results: [{ title: 'Searxng Title', content: 'Searxng Content', url: 'https://searx.example/result' }]
  },
  {
    provider: firecrawl,
    fixture: 'firecrawl-response.json',
    path: '/v2/search',
    body: '{"query":"a/b c","limit":2,"scrapeOptions":{"formats":["markdown"]}}',
    auth: ['authorization', 'Bearer dummy'],
    results: [
      { title: 'Firecrawl Title', content: 'Scraped Markdown Content', url: 'https://firecrawl.example/result' }
    ]
  },
  {
    provider: jina,
    fixture: 'jina-search-response.json',
    path: '/a%2Fb%20c',
    auth: ['authorization', 'Bearer dummy'],
    results: [{ title: 'Jina Title', content: 'Jina Content', url: 'https://jina.example/result' }]
  }
]

it.each(cases)('$provider.metadata.id preserves request bytes and maps search results', async (row) => {
  const server = await loopbackServer(await fixture(row.fixture))
  try {
    const result = await clientFor(row.provider).execute({
      providerId: row.provider.metadata.id,
      capability: 'searchKeywords',
      input,
      credentials: { apiKey: 'dummy' },
      config: {
        apiHost: server.host + '/base',
        maxResults: 2,
        engines: ['google', 'bing'],
        excludeDomains: ['blocked.test', 'other.test']
      }
    })
    expect(result).toEqual({
      providerId: row.provider.metadata.id,
      capability: 'searchKeywords',
      input,
      results: row.results.map((item) => ({ ...item, sourceInput: input }))
    })
    expect(server.requests).toHaveLength(1)
    const wire = server.requests[0]
    expect([wire.method, wire.path, wire.body]).toEqual([row.body ? 'POST' : 'GET', '/base' + row.path, row.body || ''])
    if (row.body) expect(wire.headers['content-type']).toBe('application/json')
    if (row.auth) expect(wire.headers[row.auth[0]]).toBe(row.auth[1])
    else expect(wire.headers.authorization).toBeUndefined()
  } finally {
    await server.close()
  }
})
it.each(cases)(
  '$provider.metadata.id accepts explicit empty results but rejects missing structures and invalid JSON',
  async (row) => {
    for (const [body, code] of [
      [await fixture(row.provider.metadata.id + '-empty-results.json'), undefined],
      ['{}', 'invalid_response'],
      ['not-json', 'invalid_json']
    ] as const) {
      const server = await loopbackServer(body)
      try {
        const execution = clientFor(row.provider).execute({
          providerId: row.provider.metadata.id,
          capability: 'searchKeywords',
          input,
          credentials: { apiKey: 'dummy' },
          config: { apiHost: server.host, maxResults: 2 }
        })
        if (code) await expect(execution).rejects.toMatchObject({ kind: 'invalid_response', code })
        else
          await expect(execution).resolves.toEqual({
            providerId: row.provider.metadata.id,
            capability: 'searchKeywords',
            input,
            results: []
          })
      } finally {
        await server.close()
      }
    }
  }
)

const target = 'https://target.test/a%2Fb?q=x%20y&n=2'
const fetchCases = [
  {
    provider: jina,
    fixture: 'jina-reader-response.json',
    path: '/' + target,
    body: '',
    result: { title: 'Jina Article', url: target, content: 'Reader content' },
    empty: { data: { content: '  ' } }
  },
  {
    provider: querit,
    fixture: 'querit-contents-response.json',
    path: '/v1/contents',
    body: '{"urls":["https://target.test/a%2Fb?q=x%20y&n=2"],"format":"markdown","extrasMeta":true}',
    result: {
      title: 'Querit Article',
      url: 'https://querit.example/article',
      content: '# Querit Article\n\nQuerit crawled markdown content.'
    },
    empty: { error_code: 200, error_msg: '', results: [{ content: '  ' }] }
  },
  {
    provider: firecrawl,
    fixture: 'firecrawl-scrape-response.json',
    path: '/v2/scrape',
    body: '{"url":"https://target.test/a%2Fb?q=x%20y&n=2","formats":["markdown"]}',
    result: {
      title: 'Example Domain',
      url: 'https://example.com',
      content:
        '# Example Domain\n\nThis domain is for use in documentation examples without needing permission. Avoid use in operations.\n\n[Learn more](https://iana.org/domains/example)'
    },
    empty: { success: true, data: { markdown: '  ' } }
  },
  {
    provider: crawl4ai,
    fixture: 'crawl4ai-response.json',
    path: '/md',
    body: '{"url":"https://target.test/a%2Fb?q=x%20y&n=2","f":"fit"}',
    result: { title: target, url: target, content: 'Crawled content' },
    empty: { success: true, url: target, markdown: '  ' }
  }
]
it.each(fetchCases)('$provider.metadata.id maps readable content and rejects empty pages', async (row) => {
  for (const empty of [false, true]) {
    const server = await loopbackServer(empty ? JSON.stringify(row.empty) : await fixture(row.fixture))
    try {
      const execution = clientFor(row.provider).execute({
        providerId: row.provider.metadata.id,
        capability: 'fetchUrls',
        input: target,
        config: { apiHost: server.host },
        credentials: row.provider === querit ? { apiKey: 'dummy' } : undefined
      })
      if (empty) await expect(execution).rejects.toMatchObject({ kind: 'invalid_response', code: 'empty_content' })
      else
        await expect(execution).resolves.toEqual({
          providerId: row.provider.metadata.id,
          capability: 'fetchUrls',
          input: target,
          results: [{ ...row.result, sourceInput: target }]
        })
      const wire = server.requests[0]
      expect([wire.method, wire.path, wire.body]).toEqual([row.body ? 'POST' : 'GET', row.path, row.body])
      expect(wire.headers.authorization).toBe(row.provider === querit ? 'Bearer dummy' : undefined)
      if (row.provider === jina) expect(wire.headers['x-retain-images']).toBe('none')
    } finally {
      await server.close()
    }
  }
})
it.each([400, 429, 503])('reports HTTP %s safely for JSON and text responses', async (status) => {
  for (const body of ['{"error":"secret-body"}', 'secret-body']) {
    const server = await loopbackServer(body, status)
    try {
      const error = await clientFor(tavily)
        .execute({
          providerId: 'tavily',
          capability: 'searchKeywords',
          input: 'secret-input',
          config: { apiHost: server.host, maxResults: 1 },
          credentials: { apiKey: 'secret-credential' }
        })
        .catch((error) => error)
      expect(error).toBeInstanceOf(WebSearchError)
      expect(error.toJSON()).toEqual({
        message: 'Web search HTTP request failed',
        kind: 'http',
        code: 'http_error',
        providerId: 'tavily',
        capability: 'searchKeywords',
        httpStatus: status,
        retryAfter: '3',
        requestId: 'loopback-request',
        providerCode: undefined
      })
      expect(JSON.stringify(error.toJSON())).not.toMatch(/secret|127\.0\.0\.1|stack|cause/)
    } finally {
      await server.close()
    }
  }
})
it.each([
  [bocha, { code: 403, msg: 'secret-body' }],
  [querit, { error_code: 403, error_msg: 'secret-body' }],
  [firecrawl, { success: false, error: 'secret-body' }],
  [crawl4ai, { success: false }],
  [jina, { code: 401 }],
  [zhipu, { error: { code: 'denied', message: 'secret-body' } }],
  [tavily, { error: 'secret-body' }],
  [exa, { error: 'secret-body' }],
  [parallel, { error: 'secret-body' }],
  [serply, { error: 'secret-body' }],
  [searxng, { error: 'secret-body' }]
] as const)('recognizes $0.metadata.id failure envelopes before success validation', async (provider, body) => {
  const server = await loopbackServer(JSON.stringify(body))
  try {
    const capability = provider === crawl4ai ? 'fetchUrls' : 'searchKeywords'
    await expect(
      clientFor(provider).execute({
        providerId: provider.metadata.id,
        capability,
        input,
        config: { apiHost: server.host, maxResults: 2 },
        credentials: { apiKey: 'dummy' }
      })
    ).rejects.toMatchObject({ kind: 'provider', code: 'provider_error' })
  } finally {
    await server.close()
  }
})
it('uses UTF-8 Basic Auth with a fixed Unicode credential encoding', async () => {
  const server = await loopbackServer(await fixture('searxng-empty-results.json'))
  try {
    await clientFor(searxng).execute({
      providerId: 'searxng',
      capability: 'searchKeywords',
      input: 'hello',
      config: { apiHost: server.host, maxResults: 1 },
      credentials: { basicAuthUsername: '用户', basicAuthPassword: '密码' }
    })
    expect(server.requests[0].headers.authorization).toBe('Basic 55So5oi3OuWvhueggQ==')
    expect(server.requests[0].path).toBe('/search?q=hello&language=auto&format=json')
  } finally {
    await server.close()
  }
})
it('returns all valid SearXNG URLs with raw titles and retains empty snippets', async () => {
  const server = await loopbackServer(
    '{"results":[{"url":"bad"},{"url":"ftp://x.test"},{"url":"https://ok.test","content":""},{"url":"https://later.test","title":"  Later  ","snippet":"later"}]}'
  )
  try {
    await expect(
      clientFor(searxng).execute({
        providerId: 'searxng',
        capability: 'searchKeywords',
        input,
        config: { apiHost: server.host, maxResults: 1 }
      })
    ).resolves.toMatchObject({
      results: [
        { title: '', url: 'https://ok.test', content: '', sourceInput: input },
        { title: 'Later', url: 'https://later.test', content: 'later', sourceInput: input }
      ]
    })
  } finally {
    await server.close()
  }
})
it('skips missing Querit URLs and relies on upstream count', async () => {
  const server = await loopbackServer(
    '{"error_code":200,"error_msg":"","query_context":{"query":"q"},"results":{"result":[{}, {"url":"https://one.test","snippet":"one"},{"url":"https://two.test","site_name":"Two","snippet":""}]}}'
  )
  try {
    await expect(
      clientFor(querit).execute({
        providerId: 'querit',
        capability: 'searchKeywords',
        input,
        config: { apiHost: server.host, maxResults: 1 },
        credentials: { apiKey: 'dummy' }
      })
    ).resolves.toMatchObject({
      results: [
        { title: 'one', url: 'https://one.test', content: 'one' },
        { title: 'Two', url: 'https://two.test', content: '' }
      ]
    })
    expect(server.requests[0].body).toBe('{"query":"a/b c","count":1}')
  } finally {
    await server.close()
  }
})
it('sends an empty Bocha exclusion string and no optional Firecrawl auth', async () => {
  for (const provider of [bocha, firecrawl]) {
    const server = await loopbackServer(await fixture(provider.metadata.id + '-empty-results.json'))
    try {
      await clientFor(provider).execute({
        providerId: provider.metadata.id,
        capability: 'searchKeywords',
        input,
        config: { apiHost: server.host, maxResults: 1 },
        credentials: provider === bocha ? { apiKey: 'dummy' } : undefined
      })
      if (provider === bocha)
        expect(server.requests[0].body).toBe('{"query":"a/b c","count":1,"exclude":"","summary":true}')
      else expect(server.requests[0].headers.authorization).toBeUndefined()
    } finally {
      await server.close()
    }
  }
})
it('rejects invalid hosts, missing keys and disabled capabilities before networking', async () => {
  const server = await loopbackServer('{}')
  try {
    for (const [apiHost, code] of [
      ['', 'api_host_missing'],
      ['  ', 'api_host_missing'],
      ['file:///tmp/x', 'api_host_invalid']
    ] as const)
      await expect(
        clientFor(tavily).execute({
          providerId: 'tavily',
          capability: 'searchKeywords',
          input,
          config: { apiHost, maxResults: 1 },
          credentials: { apiKey: 'dummy' }
        })
      ).rejects.toMatchObject({ kind: 'configuration', code })
    await expect(
      clientFor(tavily).execute({
        providerId: 'tavily',
        capability: 'searchKeywords',
        input,
        config: { apiHost: server.host, maxResults: 1 }
      })
    ).rejects.toMatchObject({ code: 'api_key_missing' })
    const active = createWebSearchClient({
      transport: httpTransport,
      providers: [{ provider: firecrawl, capabilities: [] }]
    })
    await expect(
      active.execute({ providerId: 'firecrawl', capability: 'fetchUrls', input, config: { apiHost: server.host } })
    ).rejects.toMatchObject({ code: 'capability_unsupported' })
    expect(server.requests).toEqual([])
  } finally {
    await server.close()
  }
})
it('propagates the original cancellation during response body consumption', async () => {
  const controller = new AbortController()
  const reason = { cancelledByCaller: true }
  const server = await loopbackServer('', 200, (response) => {
    response.write('{')
    controller.abort(reason)
  })
  try {
    await expect(
      clientFor(tavily).execute({
        providerId: 'tavily',
        capability: 'searchKeywords',
        input,
        config: { apiHost: server.host, maxResults: 1 },
        credentials: { apiKey: 'dummy' },
        signal: controller.signal
      })
    ).rejects.toBe(reason)
    expect(server.requests).toHaveLength(1)
  } finally {
    await server.close()
  }
})

it('supports Jina results arrays and Firecrawl title arrays', async () => {
  for (const provider of [jina, firecrawl]) {
    const body =
      provider === jina
        ? '{"results":[]}'
        : '{"success":true,"data":{"markdown":"content","metadata":{"title":["First title","Second title"]}}}'
    const server = await loopbackServer(body)
    try {
      const execution = clientFor(provider).execute({
        providerId: provider.metadata.id,
        capability: provider === jina ? 'searchKeywords' : 'fetchUrls',
        input: target,
        config: { apiHost: server.host, maxResults: 1 },
        credentials: { apiKey: 'dummy' }
      })
      if (provider === jina) await expect(execution).resolves.toMatchObject({ results: [] })
      else
        await expect(execution).resolves.toMatchObject({
          results: [{ title: 'First title', content: 'content', url: target, sourceInput: target }]
        })
    } finally {
      await server.close()
    }
  }
})
it('keeps optional-auth credentials verbatim in the injected transport request', async () => {
  let header: string | undefined
  const client = createWebSearchClient({
    providers: [{ provider: jina, capabilities: ['fetchUrls'] }],
    transport: {
      async request(request) {
        header = request.headers.Authorization
        return { status: 200, headers: {}, bodyText: '{"content":"page"}' }
      }
    }
  })
  await client.execute({
    providerId: 'jina',
    capability: 'fetchUrls',
    input: target,
    config: {},
    credentials: { apiKey: ' dummy ' }
  })
  expect(header).toBe('Bearer  dummy ')
})
