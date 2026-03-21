import type { ResolvedWebSearchProvider, WebSearchExecutionConfig } from '@shared/data/types/webSearch'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

import { BochaProvider } from '../api/BochaProvider'
import { ExaProvider } from '../api/ExaProvider'
import { QueritProvider } from '../api/QueritProvider'
import { SearxngProvider } from '../api/SearxngProvider'
import { TavilyProvider } from '../api/TavilyProvider'
import { ZhipuProvider } from '../api/ZhipuProvider'
import { ExaMcpProvider } from '../mcp/ExaMcpProvider'

const runtimeConfig: WebSearchExecutionConfig = {
  searchWithTime: false,
  maxResults: 4,
  excludeDomains: ['example.com'],
  compression: {
    method: 'none',
    cutoffLimit: null,
    cutoffUnit: 'char',
    ragDocumentCount: 5,
    ragEmbeddingModelId: null,
    ragEmbeddingDimensions: null,
    ragRerankModelId: null
  }
}

function createProvider(overrides: Partial<ResolvedWebSearchProvider>): ResolvedWebSearchProvider {
  return {
    id: 'tavily',
    name: 'Provider',
    type: 'api',
    usingBrowser: false,
    apiKey: 'test-key',
    apiHost: 'https://api.example.com',
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: '',
    ...overrides
  }
}

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function createHtmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html'
    }
  })
}

function getLatestFetchCall(): [string, RequestInit | undefined] {
  return fetchMock.mock.lastCall as [string, RequestInit | undefined]
}

describe('main web search API providers', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('sends Exa requests through net.fetch', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        autopromptString: 'refined query',
        results: [{ title: 'Exa Title', text: 'Exa Content', url: 'https://exa.example/result' }]
      })
    )

    const provider = new ExaProvider(
      createProvider({
        id: 'exa',
        name: 'Exa',
        apiKey: 'exa-key',
        apiHost: 'https://api.exa.ai'
      })
    )

    const result = await provider.search('hello', runtimeConfig)
    const [url, init] = getLatestFetchCall()

    expect(url).toBe('https://api.exa.ai/search')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('x-api-key')).toBe('exa-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'hello',
      numResults: 4,
      contents: { text: true }
    })
    expect(result).toEqual({
      query: 'refined query',
      results: [{ title: 'Exa Title', content: 'Exa Content', url: 'https://exa.example/result' }]
    })
  })

  it('sends Tavily requests through net.fetch', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        query: 'hello',
        results: [{ title: 'Tavily Title', content: 'Tavily Content', url: 'https://tavily.example/result' }]
      })
    )

    const provider = new TavilyProvider(
      createProvider({
        id: 'tavily',
        name: 'Tavily',
        apiKey: 'tavily-key',
        apiHost: 'https://api.tavily.com'
      })
    )

    const result = await provider.search('hello', runtimeConfig)
    const [url, init] = getLatestFetchCall()

    expect(url).toBe('https://api.tavily.com/search')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'hello',
      api_key: 'tavily-key',
      max_results: 4
    })
    expect(result.results[0]).toEqual({
      title: 'Tavily Title',
      content: 'Tavily Content',
      url: 'https://tavily.example/result'
    })
  })

  it('sends Searxng requests through net.fetch with basic auth and engines', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          query: 'hello',
          results: [{ title: 'Searxng Title', content: 'Searxng Content', url: 'https://searx.example/result' }]
        })
      )
      .mockResolvedValueOnce(
        createHtmlResponse(`
          <html>
            <head><title>Resolved Page Title</title></head>
            <body>
              <article>
                <p>Resolved content from the target page.</p>
              </article>
            </body>
          </html>
        `)
      )

    const provider = new SearxngProvider(
      createProvider({
        id: 'searxng',
        name: 'Searxng',
        apiHost: 'https://searx.example',
        engines: ['google', 'bing'],
        basicAuthUsername: 'alice',
        basicAuthPassword: 'secret'
      })
    )

    const result = await provider.search('hello', runtimeConfig)
    const [searchUrl, searchInit] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    const parsedSearchUrl = new URL(searchUrl)
    const [contentUrl, contentInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined]

    expect(parsedSearchUrl.origin + parsedSearchUrl.pathname).toBe('https://searx.example/search')
    expect(parsedSearchUrl.searchParams.get('q')).toBe('hello')
    expect(parsedSearchUrl.searchParams.get('language')).toBe('auto')
    expect(parsedSearchUrl.searchParams.get('format')).toBe('json')
    expect(parsedSearchUrl.searchParams.get('engines')).toBe('google,bing')
    expect(new Headers(searchInit?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('alice:secret').toString('base64')}`
    )
    expect(contentUrl).toBe('https://searx.example/result')
    expect(new Headers(contentInit?.headers).get('user-agent')).toContain('Mozilla/5.0')
    expect(result.results[0]).toEqual({
      title: 'Resolved Page Title',
      content: 'Resolved content from the target page.',
      url: 'https://searx.example/result'
    })
  })

  it('auto-discovers Searxng engines from config when no override is provided', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          engines: [
            { name: 'duckduckgo', enabled: true, categories: ['general', 'web'] },
            { name: 'images', enabled: true, categories: ['images'] }
          ]
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          query: 'hello',
          results: [{ title: 'Searxng Title', content: 'Searxng Content', url: 'https://searx.example/result' }]
        })
      )
      .mockResolvedValueOnce(
        createHtmlResponse(`
          <html>
            <head><title>Resolved Page Title</title></head>
            <body>
              <article>
                <p>Resolved content from the target page.</p>
              </article>
            </body>
          </html>
        `)
      )

    const provider = new SearxngProvider(
      createProvider({
        id: 'searxng',
        name: 'Searxng',
        apiHost: 'https://searx.example',
        engines: []
      })
    )

    await provider.search('hello', runtimeConfig)

    const [configUrl] = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    const [searchUrl] = fetchMock.mock.calls[1] as [string, RequestInit | undefined]
    const parsedSearchUrl = new URL(searchUrl)

    expect(configUrl).toBe('https://searx.example/config')
    expect(parsedSearchUrl.searchParams.get('engines')).toBe('duckduckgo')
  })

  it('sends Bocha requests through net.fetch', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        code: 200,
        msg: 'ok',
        data: {
          queryContext: { originalQuery: 'hello' },
          webPages: {
            value: [{ name: 'Bocha Title', summary: 'Bocha Content', url: 'https://bocha.example/result' }]
          }
        }
      })
    )

    const provider = new BochaProvider(
      createProvider({
        id: 'bocha',
        name: 'Bocha',
        apiKey: 'bocha-key',
        apiHost: 'https://api.bochaai.com'
      })
    )

    const result = await provider.search('hello', { ...runtimeConfig, searchWithTime: true })
    const [url, init] = getLatestFetchCall()

    expect(url).toBe('https://api.bochaai.com/v1/web-search')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer bocha-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'hello',
      count: 4,
      exclude: 'example.com',
      freshness: 'oneDay',
      summary: true,
      page: 1
    })
    expect(result.results[0]).toEqual({
      title: 'Bocha Title',
      content: 'Bocha Content',
      url: 'https://bocha.example/result'
    })
  })

  it('sends Querit requests through net.fetch', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        error_code: 200,
        error_msg: '',
        query_context: { query: 'hello' },
        results: {
          result: [{ title: 'Querit Title', snippet: 'Querit Content', url: 'https://querit.example/result' }]
        }
      })
    )

    const provider = new QueritProvider(
      createProvider({
        id: 'querit',
        name: 'Querit',
        apiKey: 'querit-key',
        apiHost: 'https://api.querit.ai'
      })
    )

    const result = await provider.search('hello', { ...runtimeConfig, searchWithTime: true })
    const [url, init] = getLatestFetchCall()

    expect(url).toBe('https://api.querit.ai/v1/search')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer querit-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'hello',
      count: 4,
      filters: {
        sites: { exclude: ['example.com'] },
        timeRange: { date: 'd1' }
      }
    })
    expect(result.results[0]).toEqual({
      title: 'Querit Title',
      content: 'Querit Content',
      url: 'https://querit.example/result'
    })
  })

  it('sends Zhipu requests through net.fetch', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        search_result: [{ title: 'Zhipu Title', content: 'Zhipu Content', link: 'https://zhipu.example/result' }]
      })
    )

    const provider = new ZhipuProvider(
      createProvider({
        id: 'zhipu',
        name: 'Zhipu',
        apiKey: 'zhipu-key',
        apiHost: 'https://open.bigmodel.cn/api/paas/v4/tools'
      })
    )

    const result = await provider.search('hello', runtimeConfig)
    const [url, init] = getLatestFetchCall()

    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/tools')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer zhipu-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      search_query: 'hello',
      search_engine: 'search_std',
      search_intent: false
    })
    expect(result.results[0]).toEqual({
      title: 'Zhipu Title',
      content: 'Zhipu Content',
      url: 'https://zhipu.example/result'
    })
  })

  it('sends Exa MCP requests through net.fetch and parses SSE payloads', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        'data: {"result":{"content":[{"type":"text","text":"Title: Exa MCP Title\\nURL: https://mcp.exa.ai/result\\nText: Exa MCP Content"}]}}',
        { status: 200 }
      )
    )

    const provider = new ExaMcpProvider(
      createProvider({
        id: 'exa-mcp',
        name: 'Exa MCP',
        type: 'mcp',
        apiHost: ''
      })
    )

    const result = await provider.search('hello', runtimeConfig)
    const [url, init] = getLatestFetchCall()

    expect(url).toBe('https://mcp.exa.ai/mcp')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: {
          query: 'hello',
          type: 'auto',
          numResults: 4,
          livecrawl: 'fallback'
        }
      }
    })
    expect(result.results[0]).toEqual({
      title: 'Exa MCP Title',
      content: 'Exa MCP Content',
      url: 'https://mcp.exa.ai/result'
    })
  })
})
