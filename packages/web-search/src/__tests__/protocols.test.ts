import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createWebSearchClient } from '../createWebSearchClient'
import { bocha } from '../providers/bocha'
import { crawl4ai } from '../providers/crawl4ai'
import { deepseek } from '../providers/deepseek'
import { exa } from '../providers/exa'
import { exaMcp } from '../providers/exaMcp'
import { firecrawl } from '../providers/firecrawl'
import { getJinaHostCandidates, jina } from '../providers/jina'
import { parallel } from '../providers/parallel'
import { querit } from '../providers/querit'
import { discoverSearxngEngines, searxng } from '../providers/searxng'
import { serply } from '../providers/serply'
import { tavily } from '../providers/tavily'
import { zhipu } from '../providers/zhipu'
import type { WebSearchCall, WebSearchHttpRequest, WebSearchProviderModule, WebSearchTransport } from '../types'
import { WebSearchTransportError } from '../WebSearchError'

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

function setup(provider: WebSearchProviderModule, body: string, status = 200) {
  const requests: WebSearchHttpRequest[] = []
  const transport: WebSearchTransport = {
    async request(request) {
      requests.push(request)
      return { status, headers: { 'retry-after': '12' }, bodyText: body }
    }
  }
  return {
    requests,
    transport,
    client: createWebSearchClient({
      transport,
      providers: [{ provider, capabilities: provider.metadata.capabilities.map((item) => item.capability) }]
    })
  }
}

function search(providerId: WebSearchCall['providerId']): WebSearchCall {
  return {
    providerId,
    capability: 'searchKeywords',
    input: 'hello',
    config: { apiHost: 'https://service.example/proxy', maxResults: 4 },
    credentials: { apiKey: 'test-key' }
  }
}

describe('portable provider contracts', () => {
  it.each([
    [exa, 'exa-response.json', '/search', { query: 'hello', numResults: 4, contents: { text: true } }, 'Exa Content'],
    [tavily, 'tavily-response.json', '/search', { query: 'hello', max_results: 4 }, 'Tavily Content'],
    [bocha, 'bocha-response.json', '/v1/web-search', { query: 'hello', count: 4, summary: true }, 'Bocha Content'],
    [
      parallel,
      'parallel-response.json',
      '/v1/search',
      { objective: 'hello', search_queries: ['hello'], advanced_settings: { max_results: 4 } },
      'First excerpt.\n\nSecond excerpt.'
    ],
    [querit, 'querit-response.json', '/v1/search', { query: 'hello', count: 4 }, 'Querit Content'],
    [
      firecrawl,
      'firecrawl-response.json',
      '/v2/search',
      { query: 'hello', limit: 4, scrapeOptions: { formats: ['markdown'] } },
      'Scraped Markdown Content'
    ]
  ] as const)('constructs %s requests and preserves provider content', async (provider, name, path, body, content) => {
    const { client, requests } = setup(provider, fixture(name))
    const result = await client.execute(search(provider.metadata.id))
    expect(requests[0].url).toBe(`https://service.example/proxy${path}`)
    expect(requests[0].method).toBe('POST')
    expect(JSON.parse(requests[0].body!)).toEqual(body)
    const auth = new Headers(requests[0].headers)
    expect(auth.get(['exa', 'parallel'].includes(provider.metadata.id) ? 'x-api-key' : 'authorization')).toBe(
      ['exa', 'parallel'].includes(provider.metadata.id) ? 'test-key' : 'Bearer test-key'
    )
    expect(result.results[0]).toMatchObject({ content, sourceInput: 'hello' })
  })

  it('uses the full Zhipu endpoint without appending a route', async () => {
    const { client, requests } = setup(zhipu, fixture('zhipu-response.json'))
    const result = await client.execute(search('zhipu'))
    expect(requests[0].url).toBe('https://service.example/proxy')
    expect(JSON.parse(requests[0].body!)).toEqual({
      search_query: 'hello',
      search_engine: 'search_std',
      search_intent: false
    })
    expect(result.results[0]).toMatchObject({ url: 'https://zhipu.example/result', content: 'Zhipu Content' })
  })

  it('encodes Serply search terms in the path exactly once', async () => {
    const { client, requests } = setup(serply, fixture('serply-response.json'))
    const result = await client.execute({ ...search('serply'), input: 'a&b/c' })
    expect(requests[0].url).toBe('https://service.example/proxy/v1/search/q=a%26b%2Fc&num=4')
    expect(requests[0].body).toBeUndefined()
    expect(new Headers(requests[0].headers).get('x-api-key')).toBe('test-key')
    expect(result.results[0].content).toBe('Serply Description')
  })

  it('posts DeepSeek search calls and prefers the model-facing summary', async () => {
    const { client, requests } = setup(deepseek, fixture('deepseek-search-response.json'))
    const result = await client.execute(search('deepseek'))
    expect(requests[0].url).toBe('https://service.example/proxy/v1/tools/search')
    expect(requests[0].method).toBe('POST')
    expect(JSON.parse(requests[0].body!)).toEqual({ query: 'hello', count: 4 })
    expect(new Headers(requests[0].headers).get('authorization')).toBe('Bearer test-key')
    expect(result.results).toEqual([
      {
        title: 'DeepSeek Result Title',
        url: 'https://example.com/deepseek-result',
        content: 'DeepSeek Summary',
        sourceInput: 'hello'
      },
      {
        title: 'DeepSeek Snippet Only',
        url: 'https://snippet.example/page',
        content: 'DeepSeek Snippet',
        sourceInput: 'hello'
      }
    ])
  })

  it('clamps DeepSeek search parameters to the documented API limits', async () => {
    const { client, requests } = setup(deepseek, fixture('deepseek-search-response.json'))
    await client.execute({
      providerId: 'deepseek',
      capability: 'searchKeywords',
      input: `x${'y'.repeat(200)}`,
      config: { apiHost: 'https://service.example/proxy', maxResults: 500 },
      credentials: { apiKey: 'test-key' }
    })
    expect(JSON.parse(requests[0].body!)).toEqual({ query: `x${'y'.repeat(127)}`, count: 50 })
  })

  it.each([
    ['preserves a supplementary character at the limit', `${'a'.repeat(127)}🚀`, `${'a'.repeat(127)}🚀`],
    ['truncates after a supplementary character', `${'a'.repeat(127)}𠮷extra`, `${'a'.repeat(127)}𠮷`],
    ['counts supplementary characters as single code points', '🚀'.repeat(129), '🚀'.repeat(128)]
  ])('DeepSeek %s', async (_name, input, expectedQuery) => {
    const { client, requests } = setup(deepseek, fixture('deepseek-search-response.json'))
    await client.execute({ ...search('deepseek'), input })
    expect(JSON.parse(requests[0].body!).query).toBe(expectedQuery)
  })

  it('fetches pages through the DeepSeek Fetch API and tolerates a missing title', async () => {
    const { client, requests } = setup(deepseek, fixture('deepseek-fetch-response.json'))
    const result = await client.execute({
      providerId: 'deepseek',
      capability: 'fetchUrls',
      input: 'https://example.com/article',
      config: { apiHost: 'https://service.example/proxy' },
      credentials: { apiKey: 'test-key' }
    })
    expect(requests[0].url).toBe('https://service.example/proxy/v1/tools/fetch')
    expect(requests[0].method).toBe('POST')
    expect(JSON.parse(requests[0].body!)).toEqual({ url: 'https://example.com/article' })
    expect(result.results[0]).toEqual({
      title: 'DeepSeek Fetched Page',
      content: 'Fetched page content in Markdown.',
      url: 'https://example.com/article',
      sourceInput: 'https://example.com/article'
    })

    const untitled = setup(deepseek, JSON.stringify({ content: 'Markdown body only' }))
    const untitledResult = await untitled.client.execute({
      providerId: 'deepseek',
      capability: 'fetchUrls',
      input: 'https://example.com/article',
      config: { apiHost: 'https://service.example/proxy' },
      credentials: { apiKey: 'test-key' }
    })
    expect(untitledResult.results[0].title).toBe('https://example.com/article')
  })

  it('keeps SearXNG search separate from discovery and retains hits needing host enrichment', async () => {
    const { client, requests } = setup(
      searxng,
      JSON.stringify({
        results: [
          { title: 'Page without a snippet', url: 'https://example.com/page' },
          { title: 'Unsafe citation', url: 'javascript:alert(1)' }
        ]
      })
    )
    const result = await client.execute({
      ...search('searxng'),
      credentials: { basicAuth: { username: 'user', password: 'pass' } }
    })
    expect(requests.map((request) => request.url)).toEqual([
      'https://service.example/proxy/search?q=hello&language=auto&format=json'
    ])
    expect(new Headers(requests[0].headers).get('authorization')).toBe('Basic dXNlcjpwYXNz')
    expect(result.results).toEqual([
      { title: 'Page without a snippet', url: 'https://example.com/page', content: '', sourceInput: 'hello' }
    ])
  })

  it('discovers only enabled general SearXNG engines with web-capable engines first', async () => {
    const { transport, requests } = setup(
      searxng,
      JSON.stringify({
        engines: [
          { name: 'general', categories: ['general'], enabled: true },
          { name: 'web', categories: ['general', 'web'], enabled: true },
          { name: 'images', categories: ['images'], enabled: true },
          { name: 'disabled', categories: ['general'], enabled: false }
        ]
      })
    )
    expect(await discoverSearxngEngines({ config: { apiHost: 'https://search.example/base' }, transport })).toEqual([
      'web',
      'general'
    ])
    expect(requests[0].url).toBe('https://search.example/base/config')
  })

  it('uses raw Jina Reader URLs without requiring a key or selecting mirrors', async () => {
    const { client, requests } = setup(jina, JSON.stringify({ data: { title: 'Page', content: 'Readable page' } }))
    const url = 'https://example.com/page?a=1&b=2'
    const result = await client.execute({ providerId: 'jina', capability: 'fetchUrls', input: url, config: {} })
    expect(requests[0].url).toBe(`https://r.jina.ai/${url}`)
    expect(new Headers(requests[0].headers).has('authorization')).toBe(false)
    expect(result.results[0]).toMatchObject({ content: 'Readable page', sourceInput: url })
    expect(getJinaHostCandidates('https://r.jina.ai', 'mainland-china')).toEqual([
      'https://r.jinaai.cn',
      'https://r.jina.ai'
    ])
    expect(getJinaHostCandidates('https://custom.example', 'mainland-china')).toEqual(['https://custom.example'])
  })

  it.each([
    [
      querit,
      'querit-contents-response.json',
      '/v1/contents',
      { urls: ['https://example.com'], format: 'markdown', extrasMeta: true },
      'Querit Article'
    ],
    [
      firecrawl,
      'firecrawl-scrape-response.json',
      '/v2/scrape',
      { url: 'https://example.com', formats: ['markdown'] },
      'Example Domain'
    ],
    [crawl4ai, undefined, '/md', { url: 'https://example.com', f: 'fit' }, 'https://example.com']
  ] as const)('fetches readable content through %s', async (provider, name, path, body, title) => {
    const { client, requests } = setup(
      provider,
      name ? fixture(name) : JSON.stringify({ url: 'https://example.com', markdown: 'Article', success: true })
    )
    const result = await client.execute({
      providerId: provider.metadata.id,
      capability: 'fetchUrls',
      input: 'https://example.com',
      config: { apiHost: 'https://service.example' },
      credentials: { apiKey: 'test-key' }
    })
    expect(requests[0].url).toBe(`https://service.example${path}`)
    expect(JSON.parse(requests[0].body!)).toEqual(body)
    expect(result.results[0].title).toBe(title)
    expect(result.results[0].content.length).toBeGreaterThan(0)
  })
})

describe('Querit and Crawl4AI deployment contracts', () => {
  it.each(['https://api.querit.ai/v1', 'https://api.querit.ai/v1/'])(
    'accepts string success codes and an already versioned Querit API host %s',
    async (apiHost) => {
      const searchProvider = setup(
        querit,
        JSON.stringify({ ...JSON.parse(fixture('querit-response.json')), error_code: '200' })
      )
      const searchResult = await searchProvider.client.execute({
        ...search('querit'),
        capability: 'searchKeywords',
        config: { apiHost, maxResults: 4 }
      })
      expect(searchProvider.requests[0].url).toBe('https://api.querit.ai/v1/search')
      expect(searchResult.results[0].content).toBe('Querit Content')

      const fetchProvider = setup(
        querit,
        JSON.stringify({ ...JSON.parse(fixture('querit-contents-response.json')), error_code: '200' })
      )
      const fetchResult = await fetchProvider.client.execute({
        providerId: 'querit',
        capability: 'fetchUrls',
        input: 'https://querit.example/article',
        config: { apiHost },
        credentials: { apiKey: 'test-key' }
      })
      expect(fetchProvider.requests[0].url).toBe('https://api.querit.ai/v1/contents')
      expect(fetchResult.results[0].content).toBe('# Querit Article\n\nQuerit crawled markdown content.')
    }
  )

  it.each(['searchKeywords', 'fetchUrls'] as const)(
    'preserves Querit string error codes for %s',
    async (capability) => {
      const { client } = setup(querit, JSON.stringify({ error_code: '401', error_msg: 'Invalid credential' }))
      await expect(
        client.execute(
          capability === 'searchKeywords'
            ? search('querit')
            : {
                providerId: 'querit',
                capability,
                input: 'https://querit.example/article',
                config: {},
                credentials: { apiKey: 'test-key' }
              }
        )
      ).rejects.toMatchObject({ kind: 'provider', providerCode: '401', message: 'Invalid credential' })
    }
  )

  it.each(['https://crawl4ai.com', 'https://api.crawl4ai.com'])(
    'uses the authenticated Cloud scrape protocol for %s',
    async (apiHost) => {
      const { client, requests } = setup(crawl4ai, JSON.stringify({ ok: true, markdown: '  # Example Domain  ' }))
      const url = 'https://example.com'
      const result = await client.execute({
        providerId: 'crawl4ai',
        capability: 'fetchUrls',
        input: url,
        config: { apiHost },
        credentials: { apiKey: 'cloud-key' }
      })
      expect(requests[0].url).toBe(`${apiHost}/scrape`)
      expect(JSON.parse(requests[0].body!)).toEqual({ url, format: 'md' })
      expect(new Headers(requests[0].headers).get('authorization')).toBe('Bearer cloud-key')
      expect(result.results).toEqual([{ title: url, content: '# Example Domain', url, sourceInput: url }])
    }
  )

  it('rejects Crawl4AI Cloud requests without a key before making a network request', async () => {
    const { client, requests } = setup(crawl4ai, '{}')
    await expect(
      client.execute({
        providerId: 'crawl4ai',
        capability: 'fetchUrls',
        input: 'https://example.com',
        config: { apiHost: 'https://api.crawl4ai.com' }
      })
    ).rejects.toMatchObject({ kind: 'configuration', code: 'api_key_missing' })
    expect(requests).toEqual([])
  })

  it.each([
    [{ ok: false }, 'provider', 'provider_error'],
    [{ ok: true, markdown: '   ' }, 'invalid_response', 'empty_content'],
    [{ ok: 'true', markdown: 'Invalid success flag' }, 'invalid_response', 'schema_mismatch']
  ])('rejects unsuccessful, empty, or malformed Crawl4AI Cloud results: %j', async (payload, kind, code) => {
    const { client } = setup(crawl4ai, JSON.stringify(payload))
    await expect(
      client.execute({
        providerId: 'crawl4ai',
        capability: 'fetchUrls',
        input: 'https://example.com',
        config: { apiHost: 'https://api.crawl4ai.com' },
        credentials: { apiKey: 'cloud-key' }
      })
    ).rejects.toMatchObject({ kind, code })
  })

  it.each(['http://localhost:11235/proxy', 'https://crawl4ai.com.example.org/proxy'])(
    'keeps the token-optional self-hosted protocol for %s',
    async (apiHost) => {
      const url = 'https://example.com'
      const { client, requests } = setup(
        crawl4ai,
        JSON.stringify({ url, markdown: '  Self-hosted page  ', success: true })
      )
      const result = await client.execute({
        providerId: 'crawl4ai',
        capability: 'fetchUrls',
        input: url,
        config: { apiHost }
      })
      expect(requests[0].url).toBe(`${apiHost}/md`)
      expect(JSON.parse(requests[0].body!)).toEqual({ url, f: 'fit' })
      expect(new Headers(requests[0].headers).has('authorization')).toBe(false)
      expect(result.results).toEqual([{ title: url, content: 'Self-hosted page', url, sourceInput: url }])
    }
  )
})

describe('Exa MCP content contracts', () => {
  it.each(['exa-mcp-response.txt', 'exa-mcp-highlights-response.txt'])(
    'retains search content from %s',
    async (name) => {
      const { client, requests } = setup(exaMcp, fixture(name))
      const result = await client.execute(search('exa-mcp'))
      expect(result.results.length).toBeGreaterThan(0)
      expect(result.results[0].content.length).toBeGreaterThan(0)
      expect(JSON.parse(requests[0].body!).params.name).toBe('web_search_exa')
      if (name === 'exa-mcp-highlights-response.txt') {
        expect(result.results.map((item) => item.url)).toEqual([
          'https://reactnative.dev/docs/network',
          'https://reactnative.dev/docs/next/network'
        ])
      }
    }
  )

  it('preserves paragraphs and recovers legacy adjacent data frames after malformed frames', async () => {
    const text = 'Title: Example\nURL: https://example.com\nText: First paragraph.\n\nSecond paragraph.'
    const { client } = setup(
      exaMcp,
      `data: [DONE]\ndata: broken\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text }] } })}`
    )
    expect((await client.execute(search('exa-mcp'))).results[0].content).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('keeps empty MCP titles from consuming the following URL line', async () => {
    const text = 'Title: \nURL: https://example.com\nText: Page content'
    const { client } = setup(exaMcp, JSON.stringify({ result: { content: [{ type: 'text', text }] } }))
    expect((await client.execute(search('exa-mcp'))).results).toEqual([
      { title: '', url: 'https://example.com', content: 'Page content', sourceInput: 'hello' }
    ])
  })

  it('decodes standard multi-line SSE JSON without losing text paragraphs', async () => {
    const text = 'Title: Example\nURL: https://example.com\nText: First paragraph.\n\nSecond paragraph.'
    const result = JSON.stringify({ content: [{ type: 'text', text }] })
    const { client } = setup(exaMcp, `event: message\ndata: {\ndata: "result": ${result}\ndata: }\n\n`)
    expect((await client.execute(search('exa-mcp'))).results[0].content).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('fetches existing MCP page content without requiring an API key', async () => {
    const { client, requests } = setup(exaMcp, fixture('exa-mcp-fetch-response.txt'))
    const result = await client.execute({
      providerId: 'exa-mcp',
      capability: 'fetchUrls',
      input: 'https://example.com',
      config: { maxCharacters: 24_000 }
    })
    expect(result.results[0].content.length).toBeGreaterThan(0)
    expect(JSON.parse(requests[0].body!).params).toEqual({
      name: 'web_fetch_exa',
      arguments: { urls: ['https://example.com'], maxCharacters: 24_000 }
    })
    expect(new Headers(requests[0].headers).has('x-api-key')).toBe(false)
  })

  it('distinguishes explicit zero search hits from unreadable pages and malformed responses', async () => {
    const { client } = setup(exaMcp, JSON.stringify({ result: { content: [] } }))
    expect((await client.execute(search('exa-mcp'))).results).toEqual([])
    await expect(
      client.execute({ providerId: 'exa-mcp', capability: 'fetchUrls', input: 'https://example.com', config: {} })
    ).rejects.toMatchObject({ kind: 'invalid_response', code: 'empty_content' })
    await expect(setup(exaMcp, 'data: broken').client.execute(search('exa-mcp'))).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'mcp_invalid_response'
    })
  })

  it.each(['exa-mcp-zero-results-response.json', 'exa-mcp-zero-results-response.txt'])(
    'accepts successful zero search hits from %s without treating them as page content',
    async (name) => {
      const { client } = setup(exaMcp, fixture(name))
      expect((await client.execute(search('exa-mcp'))).results).toEqual([])
      await expect(
        client.execute({ providerId: 'exa-mcp', capability: 'fetchUrls', input: 'https://example.com', config: {} })
      ).rejects.toMatchObject({ kind: 'invalid_response', code: 'empty_content' })
    }
  )

  it('rejects unrecognized successful MCP search text', async () => {
    const { client } = setup(
      exaMcp,
      JSON.stringify({ result: { content: [{ type: 'text', text: 'Unexpected search response' }] } })
    )
    await expect(client.execute(search('exa-mcp'))).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'mcp_invalid_response'
    })
  })

  it('preserves MCP tool failures even when their text matches the zero-hit response', async () => {
    const response = JSON.parse(fixture('exa-mcp-zero-results-response.json'))
    response.result.isError = true
    const { client } = setup(exaMcp, JSON.stringify(response))
    await expect(client.execute(search('exa-mcp'))).rejects.toMatchObject({
      kind: 'provider',
      code: 'provider_error'
    })
  })
})

describe('failure and capability contracts', () => {
  it('does not enable additional capabilities through a package upgrade', async () => {
    const { transport, requests } = setup(exaMcp, '{}')
    const client = createWebSearchClient({
      transport,
      providers: [{ provider: exaMcp, capabilities: ['searchKeywords'] }]
    })
    await expect(
      client.execute({ providerId: 'exa-mcp', capability: 'fetchUrls', input: 'https://example.com', config: {} })
    ).rejects.toMatchObject({ kind: 'configuration', code: 'capability_unsupported' })
    expect(requests).toEqual([])
  })

  it('rejects missing credentials and explicit empty hosts before a network request', async () => {
    const { client, requests } = setup(tavily, '{}')
    await expect(client.execute({ ...search('tavily'), credentials: undefined })).rejects.toMatchObject({
      code: 'api_key_missing'
    })
    await expect(
      client.execute({ ...search('tavily'), capability: 'searchKeywords', config: { apiHost: '', maxResults: 4 } })
    ).rejects.toMatchObject({ code: 'api_host_missing' })
    expect(requests).toEqual([])
  })

  it('preserves provider failures even when success-only fields are missing', async () => {
    await expect(
      setup(bocha, JSON.stringify({ code: 401, msg: 'Invalid credential' })).client.execute(search('bocha'))
    ).rejects.toMatchObject({ kind: 'provider', providerCode: '401' })
    await expect(
      setup(exaMcp, JSON.stringify({ error: { code: -32000, message: 'Quota exhausted' } })).client.execute(
        search('exa-mcp')
      )
    ).rejects.toMatchObject({ kind: 'provider', providerCode: '-32000' })
  })

  it('preserves HTTP retry hints while redacting configured credentials', async () => {
    const { client } = setup(tavily, JSON.stringify({ message: 'Credential test-key rejected', code: 'quota' }), 429)
    try {
      await client.execute(search('tavily'))
      throw new Error('Expected an HTTP failure')
    } catch (error) {
      expect(error).toMatchObject({ kind: 'http', status: 429, retryAfter: '12', providerCode: 'quota' })
      expect(JSON.stringify(error)).not.toContain('test-key')
    }
  })

  it('propagates cancellation before and after transport without returning partial results', async () => {
    const controller = new AbortController()
    const { client, requests } = setup(tavily, fixture('tavily-response.json'))
    controller.abort()
    await expect(client.execute({ ...search('tavily'), signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled',
      name: 'AbortError'
    })
    expect(requests).toEqual([])
    const after = new AbortController()
    const delayed = createWebSearchClient({
      providers: [{ provider: tavily, capabilities: ['searchKeywords'] }],
      transport: {
        async request() {
          after.abort()
          return { status: 200, headers: {}, bodyText: fixture('tavily-response.json') }
        }
      }
    })
    await expect(delayed.execute({ ...search('tavily'), signal: after.signal })).rejects.toMatchObject({
      kind: 'cancelled'
    })
  })

  it('does not mistake an internal transport abort for caller cancellation', async () => {
    const client = createWebSearchClient({
      providers: [{ provider: tavily, capabilities: ['searchKeywords'] }],
      transport: {
        async request() {
          throw new WebSearchTransportError('cancelled', 'internal request stopped')
        }
      }
    })
    await expect(client.execute(search('tavily'))).rejects.toMatchObject({ kind: 'network', name: 'WebSearchError' })
  })

  it('rejects malformed successful JSON while accepting an explicit empty result set', async () => {
    const payload = { query: 'hello', request_id: 'request', response_time: 1, results: [] }
    expect((await setup(tavily, JSON.stringify(payload)).client.execute(search('tavily'))).results).toEqual([])
    await expect(
      setup(tavily, JSON.stringify({ ...payload, results: 'invalid' })).client.execute(search('tavily'))
    ).rejects.toMatchObject({ kind: 'invalid_response', code: 'schema_mismatch' })
  })

  it('keeps transport timeouts distinct from caller cancellation', async () => {
    const client = createWebSearchClient({
      providers: [{ provider: tavily, capabilities: ['searchKeywords'] }],
      transport: {
        async request() {
          throw new WebSearchTransportError('timeout', 'deadline')
        }
      }
    })
    await expect(client.execute(search('tavily'))).rejects.toMatchObject({ kind: 'timeout', name: 'TimeoutError' })
  })
})
