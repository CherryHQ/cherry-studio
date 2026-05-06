import type * as NodeFs from 'node:fs'

import type { ResolvedWebSearchProvider, WebSearchExecutionConfig } from '@shared/data/types/webSearch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { FetchProvider } from '../api/FetchProvider'
import { JinaProvider } from '../api/JinaProvider'
import { QueritProvider } from '../api/QueritProvider'
import { SearxngProvider } from '../api/SearxngProvider'
import { TavilyProvider } from '../api/TavilyProvider'
import { ZhipuProvider } from '../api/ZhipuProvider'
import { ExaMcpProvider } from '../mcp/ExaMcpProvider'

const { readFileSync } = await vi.importActual<typeof NodeFs>('node:fs')

const runtimeConfig: WebSearchExecutionConfig = {
  maxResults: 4,
  excludeDomains: ['example.com'],
  compression: {
    method: 'none',
    cutoffLimit: 2000,
    cutoffUnit: 'char'
  }
}

function createProvider(
  overrides: Partial<ResolvedWebSearchProvider> & { apiHost?: string }
): ResolvedWebSearchProvider {
  const { apiHost, capabilities, ...restOverrides } = overrides
  const id = overrides.id ?? 'tavily'
  const resolvedApiHost = apiHost ?? 'https://api.example.com'
  const resolvedCapabilities =
    capabilities ??
    (id === 'fetch'
      ? [{ feature: 'fetchUrls' as const, apiHost: resolvedApiHost }]
      : id === 'jina'
        ? [
            { feature: 'searchKeywords' as const, apiHost: 'https://s.jina.ai' },
            { feature: 'fetchUrls' as const, apiHost: resolvedApiHost }
          ]
        : [{ feature: 'searchKeywords' as const, apiHost: resolvedApiHost }])

  return {
    id: 'tavily',
    name: 'Provider',
    type: 'api',
    apiKeys: ['test-key'],
    capabilities: resolvedCapabilities,
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: '',
    ...restOverrides
  }
}

function loadFixtureText(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

function loadFixtureJson<T>(name: string): T {
  return JSON.parse(loadFixtureText(name)) as T
}

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function createTextResponse(body: string, contentType: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType
    }
  })
}

function serializeRequestBody(body: RequestInit['body']) {
  if (!body) {
    return null
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return body
    }
  }

  return String(body)
}

function toRequestSnapshot(call: [string, RequestInit | undefined]) {
  const [url, init] = call

  return {
    url,
    method: init?.method ?? 'GET',
    headers: Object.fromEntries(
      [...new Headers(init?.headers).entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
    body: serializeRequestBody(init?.body)
  }
}

describe('main web search API providers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('matches Exa request and normalized response snapshots from fixtures', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(loadFixtureJson('exa-response.json')))

    const provider = new ExaProvider(
      createProvider({
        id: 'exa',
        name: 'Exa',
        apiKeys: ['exa-key'],
        apiHost: 'https://api.exa.ai'
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "contents": {
              "text": true,
            },
            "numResults": 4,
            "query": "hello",
          },
          "headers": {
            "content-type": "application/json",
            "http-referer": "https://cherry-ai.com",
            "x-api-key": "exa-key",
            "x-title": "Cherry Studio",
          },
          "method": "POST",
          "url": "https://api.exa.ai/search",
        },
        "result": {
          "capability": "searchKeywords",
          "inputs": [
            "hello",
          ],
          "providerId": "exa",
          "query": "hello",
          "results": [
            {
              "content": "Exa Content",
              "sourceInput": "hello",
              "title": "Exa Title",
              "url": "https://exa.example/result",
            },
          ],
        },
      }
    `)
  })

  it('matches Tavily request and normalized response snapshots from fixtures', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(loadFixtureJson('tavily-response.json')))

    const provider = new TavilyProvider(
      createProvider({
        id: 'tavily',
        name: 'Tavily',
        apiKeys: ['tavily-key'],
        apiHost: 'https://api.tavily.com'
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "max_results": 4,
            "query": "hello",
          },
          "headers": {
            "authorization": "Bearer tavily-key",
            "content-type": "application/json",
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "POST",
          "url": "https://api.tavily.com/search",
        },
        "result": {
          "capability": "searchKeywords",
          "inputs": [
            "hello",
          ],
          "providerId": "tavily",
          "query": "hello",
          "results": [
            {
              "content": "Tavily Content",
              "sourceInput": "hello",
              "title": "Tavily Title",
              "url": "https://tavily.example/result",
            },
          ],
        },
      }
    `)
  })

  it('fetches a URL without API key or API host', async () => {
    fetchMock.mockResolvedValue(createTextResponse(loadFixtureText('searxng-page.html'), 'text/html'))

    const provider = new FetchProvider(
      createProvider({
        id: 'fetch',
        name: 'Fetch',
        apiKeys: [],
        apiHost: ''
      })
    )

    const result = await provider.fetchUrls('https://example.com/article', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": null,
          "headers": {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          "method": "GET",
          "url": "https://example.com/article",
        },
        "result": {
          "capability": "fetchUrls",
          "inputs": [
            "https://example.com/article",
          ],
          "providerId": "fetch",
          "query": "https://example.com/article",
          "results": [
            {
              "content": "Resolved content from the target page.",
              "sourceInput": "https://example.com/article",
              "title": "Resolved Page Title",
              "url": "https://example.com/article",
            },
          ],
        },
      }
    `)
  })

  it('matches Jina fetch URL request and normalized response snapshot', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse({
        code: 200,
        data: {
          title: 'Reader Title',
          content: 'Reader Content',
          url: 'https://example.com/article'
        }
      })
    )

    const provider = new JinaProvider(
      createProvider({
        id: 'jina',
        name: 'Jina',
        apiKeys: ['jina-key'],
        apiHost: 'https://r.jina.ai'
      })
    )

    const result = await provider.fetchUrls('https://example.com/article', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": null,
          "headers": {
            "accept": "application/json",
            "authorization": "Bearer jina-key",
            "http-referer": "https://cherry-ai.com",
            "x-retain-images": "none",
            "x-title": "Cherry Studio",
          },
          "method": "GET",
          "url": "https://r.jina.ai/https://example.com/article",
        },
        "result": {
          "capability": "fetchUrls",
          "inputs": [
            "https://example.com/article",
          ],
          "providerId": "jina",
          "query": "https://example.com/article",
          "results": [
            {
              "content": "Reader Content",
              "sourceInput": "https://example.com/article",
              "title": "Reader Title",
              "url": "https://example.com/article",
            },
          ],
        },
      }
    `)
  })

  it('throws a clear error for non-URL reader queries', async () => {
    const provider = new JinaProvider(
      createProvider({
        id: 'jina',
        name: 'Jina',
        apiKeys: ['jina-key'],
        apiHost: 'https://r.jina.ai'
      })
    )

    await expect(provider.fetchUrls('not a url', runtimeConfig)).rejects.toThrow('Invalid URL format: not a url')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('matches Searxng search requests and parsed content snapshots from fixtures', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(loadFixtureJson('searxng-search-response.json')))
      .mockResolvedValueOnce(createTextResponse(loadFixtureText('searxng-page.html'), 'text/html'))

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

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect({
      searchRequest: toRequestSnapshot(fetchMock.mock.calls[0] as [string, RequestInit | undefined]),
      contentRequest: toRequestSnapshot(fetchMock.mock.calls[1] as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "contentRequest": {
          "body": null,
          "headers": {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          "method": "GET",
          "url": "https://searx.example/result",
        },
        "result": {
          "capability": "searchKeywords",
          "inputs": [
            "hello",
          ],
          "providerId": "searxng",
          "query": "hello",
          "results": [
            {
              "content": "Resolved content from the target page.",
              "sourceInput": "hello",
              "title": "Resolved Page Title",
              "url": "https://searx.example/result",
            },
          ],
        },
        "searchRequest": {
          "body": null,
          "headers": {
            "authorization": "Basic YWxpY2U6c2VjcmV0",
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "GET",
          "url": "https://searx.example/search?q=hello&language=auto&format=json&engines=google%2Cbing",
        },
      }
    `)
  })

  it('matches Searxng auto-discovery requests from fixtures', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(loadFixtureJson('searxng-config-response.json')))
      .mockResolvedValueOnce(createJsonResponse(loadFixtureJson('searxng-search-response.json')))
      .mockResolvedValueOnce(createTextResponse(loadFixtureText('searxng-page.html'), 'text/html'))

    const provider = new SearxngProvider(
      createProvider({
        id: 'searxng',
        name: 'Searxng',
        apiHost: 'https://searx.example',
        engines: []
      })
    )

    await provider.searchKeywords('hello', runtimeConfig)

    expect({
      configRequest: toRequestSnapshot(fetchMock.mock.calls[0] as [string, RequestInit | undefined]),
      searchRequest: toRequestSnapshot(fetchMock.mock.calls[1] as [string, RequestInit | undefined])
    }).toMatchInlineSnapshot(`
      {
        "configRequest": {
          "body": null,
          "headers": {
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "GET",
          "url": "https://searx.example/config",
        },
        "searchRequest": {
          "body": null,
          "headers": {
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "GET",
          "url": "https://searx.example/search?q=hello&language=auto&format=json&engines=duckduckgo",
        },
      }
    `)
  })

  it('filters empty fetched content from Searxng results', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(loadFixtureJson('searxng-search-response.json')))
      .mockResolvedValueOnce(createTextResponse('<html><body><div></div></body></html>', 'text/html'))

    const provider = new SearxngProvider(
      createProvider({
        id: 'searxng',
        name: 'Searxng',
        apiHost: 'https://searx.example',
        engines: ['google', 'bing']
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect(result).toEqual({
      query: 'hello',
      providerId: 'searxng',
      capability: 'searchKeywords',
      inputs: ['hello'],
      results: []
    })
  })

  it('keeps successful Searxng content fetches when some results fail', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          query: 'hello',
          results: [
            {
              title: 'First result',
              url: 'https://searx.example/first'
            },
            {
              title: 'Second result',
              url: 'https://searx.example/second'
            }
          ]
        })
      )
      .mockResolvedValueOnce(createTextResponse(loadFixtureText('searxng-page.html'), 'text/html'))
      .mockResolvedValueOnce(createTextResponse('server error', 'text/plain', 500))

    const provider = new SearxngProvider(
      createProvider({
        id: 'searxng',
        name: 'Searxng',
        apiHost: 'https://searx.example',
        engines: ['google', 'bing']
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect(result).toEqual({
      query: 'hello',
      providerId: 'searxng',
      capability: 'searchKeywords',
      inputs: ['hello'],
      results: [
        {
          title: 'Resolved Page Title',
          content: 'Resolved content from the target page.',
          url: 'https://searx.example/first',
          sourceInput: 'hello'
        }
      ]
    })
  })

  it('throws when every Searxng content fetch fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          query: 'hello',
          results: [
            {
              title: 'Broken result',
              url: 'https://searx.example/broken'
            }
          ]
        })
      )
      .mockResolvedValueOnce(createTextResponse('server error', 'text/plain', 500))

    const provider = new SearxngProvider(
      createProvider({
        id: 'searxng',
        name: 'Searxng',
        apiHost: 'https://searx.example',
        engines: ['google', 'bing']
      })
    )

    await expect(provider.searchKeywords('hello', runtimeConfig)).rejects.toThrow('HTTP error: 500')
  })

  it('matches Bocha request and normalized response snapshots from fixtures', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(loadFixtureJson('bocha-response.json')))

    const provider = new BochaProvider(
      createProvider({
        id: 'bocha',
        name: 'Bocha',
        apiKeys: ['bocha-key'],
        apiHost: 'https://api.bochaai.com'
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "count": 4,
            "exclude": "example.com",
            "query": "hello",
            "summary": true,
          },
          "headers": {
            "authorization": "Bearer bocha-key",
            "content-type": "application/json",
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "POST",
          "url": "https://api.bochaai.com/v1/web-search",
        },
        "result": {
          "capability": "searchKeywords",
          "inputs": [
            "hello",
          ],
          "providerId": "bocha",
          "query": "hello",
          "results": [
            {
              "content": "Bocha Content",
              "sourceInput": "hello",
              "title": "Bocha Title",
              "url": "https://bocha.example/result",
            },
          ],
        },
      }
    `)
  })

  it('matches Querit request and normalized response snapshots from fixtures', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(loadFixtureJson('querit-response.json')))

    const provider = new QueritProvider(
      createProvider({
        id: 'querit',
        name: 'Querit',
        apiKeys: ['querit-key'],
        apiHost: 'https://api.querit.ai'
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "count": 4,
            "filters": {
              "sites": {
                "exclude": [
                  "example.com",
                ],
              },
            },
            "query": "hello",
          },
          "headers": {
            "authorization": "Bearer querit-key",
            "content-type": "application/json",
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "POST",
          "url": "https://api.querit.ai/v1/search",
        },
        "result": {
          "capability": "searchKeywords",
          "inputs": [
            "hello",
          ],
          "providerId": "querit",
          "query": "hello",
          "results": [
            {
              "content": "Querit Content",
              "sourceInput": "hello",
              "title": "Querit Title",
              "url": "https://querit.example/result",
            },
          ],
        },
      }
    `)
  })

  it('matches Zhipu request and normalized response snapshots from fixtures', async () => {
    fetchMock.mockResolvedValue(createJsonResponse(loadFixtureJson('zhipu-response.json')))

    const provider = new ZhipuProvider(
      createProvider({
        id: 'zhipu',
        name: 'Zhipu',
        apiKeys: ['zhipu-key'],
        apiHost: 'https://open.bigmodel.cn/api/paas/v4/tools'
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "search_engine": "search_std",
            "search_intent": false,
            "search_query": "hello",
          },
          "headers": {
            "authorization": "Bearer zhipu-key",
            "content-type": "application/json",
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "POST",
          "url": "https://open.bigmodel.cn/api/paas/v4/tools",
        },
        "result": {
          "capability": "searchKeywords",
          "inputs": [
            "hello",
          ],
          "providerId": "zhipu",
          "query": "hello",
          "results": [
            {
              "content": "Zhipu Content",
              "sourceInput": "hello",
              "title": "Zhipu Title",
              "url": "https://zhipu.example/result",
            },
          ],
        },
      }
    `)
  })

  it('adds provider context when API response validation fails', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({ results: 'invalid' }))

    const provider = new ExaProvider(
      createProvider({
        id: 'exa',
        name: 'Exa',
        apiKeys: ['exa-key'],
        apiHost: 'https://api.exa.ai'
      })
    )

    await expect(provider.searchKeywords('hello', runtimeConfig)).rejects.toThrow(
      'exa search response validation failed for https://api.exa.ai/search'
    )
  })

  it('adds provider context when API response body is invalid JSON', async () => {
    fetchMock.mockResolvedValue(createTextResponse('{invalid-json', 'application/json'))

    const provider = new SearxngProvider(
      createProvider({
        id: 'searxng',
        name: 'Searxng',
        apiHost: 'https://searx.example',
        engines: []
      })
    )

    await expect(provider.searchKeywords('hello', runtimeConfig)).rejects.toThrow(
      'searxng config returned invalid JSON from https://searx.example/config'
    )
  })

  it('truncates oversized upstream HTTP error bodies in provider errors', async () => {
    fetchMock.mockResolvedValue(createTextResponse('x'.repeat(600), 'text/plain', 502))

    const provider = new ExaProvider(
      createProvider({
        id: 'exa',
        name: 'Exa',
        apiKeys: ['exa-key'],
        apiHost: 'https://api.exa.ai'
      })
    )

    await expect(provider.searchKeywords('hello', runtimeConfig)).rejects.toThrow(
      `Exa search failed: HTTP 502 ${'x'.repeat(500)}... [truncated]`
    )
  })

  it('matches Exa MCP request and normalized response snapshots from fixtures', async () => {
    fetchMock.mockResolvedValue(createTextResponse(loadFixtureText('exa-mcp-response.txt'), 'text/event-stream'))

    const provider = new ExaMcpProvider(
      createProvider({
        id: 'exa-mcp',
        name: 'Exa MCP',
        type: 'mcp',
        apiHost: ''
      })
    )

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect({
      request: toRequestSnapshot(fetchMock.mock.lastCall as [string, RequestInit | undefined]),
      result
    }).toMatchInlineSnapshot(`
      {
        "request": {
          "body": {
            "id": 1,
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
              "arguments": {
                "livecrawl": "fallback",
                "numResults": 4,
                "query": "hello",
                "type": "auto",
              },
              "name": "web_search_exa",
            },
          },
          "headers": {
            "accept": "application/json, text/event-stream",
            "content-type": "application/json",
            "http-referer": "https://cherry-ai.com",
            "x-title": "Cherry Studio",
          },
          "method": "POST",
          "url": "https://mcp.exa.ai/mcp",
        },
        "result": {
          "capability": "searchKeywords",
          "inputs": [
            "hello",
          ],
          "providerId": "exa-mcp",
          "query": "hello",
          "results": [
            {
              "content": "Exa MCP Content",
              "sourceInput": "hello",
              "title": "Exa MCP Title",
              "url": "https://mcp.exa.ai/result",
            },
          ],
        },
      }
    `)
  })

  it('skips malformed Exa MCP SSE frames and keeps parsing later frames', async () => {
    fetchMock.mockResolvedValue(
      createTextResponse(
        [
          'data: [DONE]',
          'data: {"invalid": true}',
          'data: {"result":{"content":[{"type":"text","text":"Title: Exa MCP Title\\nURL: https://mcp.exa.ai/result\\nText: Exa MCP Content"}]}}'
        ].join('\n'),
        'text/event-stream'
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

    const result = await provider.searchKeywords('hello', runtimeConfig)

    expect(result).toEqual({
      query: 'hello',
      providerId: 'exa-mcp',
      capability: 'searchKeywords',
      inputs: ['hello'],
      results: [
        {
          title: 'Exa MCP Title',
          content: 'Exa MCP Content',
          url: 'https://mcp.exa.ai/result',
          sourceInput: 'hello'
        }
      ]
    })
  })

  it('throws when Exa MCP response is non-empty but contains no parseable payloads', async () => {
    fetchMock.mockResolvedValue(createTextResponse('data: {"invalid": true}', 'text/event-stream'))

    const provider = new ExaMcpProvider(
      createProvider({
        id: 'exa-mcp',
        name: 'Exa MCP',
        type: 'mcp',
        apiHost: ''
      })
    )

    await expect(provider.searchKeywords('hello', runtimeConfig)).rejects.toThrow(
      'Exa MCP response parsing failed: no parseable content found'
    )
  })

  it('surfaces Exa MCP internal timeout as TimeoutError instead of AbortError', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_, init) => {
      const signal = init?.signal as AbortSignal | undefined

      return new Promise((_, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
          },
          { once: true }
        )
      })
    })

    const provider = new ExaMcpProvider(
      createProvider({
        id: 'exa-mcp',
        name: 'Exa MCP',
        type: 'mcp',
        apiHost: ''
      })
    )

    const searchPromise = provider.searchKeywords('hello', runtimeConfig)
    const timeoutAssertion = expect(searchPromise).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Exa MCP search timed out after 25000ms'
    })

    await vi.advanceTimersByTimeAsync(25000)
    await timeoutAssertion
  })

  it('normalizes missing provider titles to empty strings', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          results: [{ title: null, text: 'Exa Content', url: 'https://exa.example/result' }],
          autopromptString: 'refined query'
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          query: 'hello',
          request_id: 'req',
          response_time: 10,
          results: [{ content: 'Tavily Content', url: 'https://tavily.example/result' }]
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          search_result: [{ content: 'Zhipu Content', link: 'https://zhipu.example/result' }]
        })
      )
      .mockResolvedValueOnce(
        createTextResponse(
          'data: {"result":{"content":[{"type":"text","text":"Title: \\nURL: https://mcp.exa.ai/result\\nText: Exa MCP Content"}]}}',
          'text/event-stream'
        )
      )

    const exaProvider = new ExaProvider(
      createProvider({
        id: 'exa',
        name: 'Exa',
        apiKeys: ['exa-key'],
        apiHost: 'https://api.exa.ai'
      })
    )
    const tavilyProvider = new TavilyProvider(
      createProvider({
        id: 'tavily',
        name: 'Tavily',
        apiKeys: ['tavily-key'],
        apiHost: 'https://api.tavily.com'
      })
    )
    const zhipuProvider = new ZhipuProvider(
      createProvider({
        id: 'zhipu',
        name: 'Zhipu',
        apiKeys: ['zhipu-key'],
        apiHost: 'https://open.bigmodel.cn/api/paas/v4/tools'
      })
    )
    const exaMcpProvider = new ExaMcpProvider(
      createProvider({
        id: 'exa-mcp',
        name: 'Exa MCP',
        type: 'mcp',
        apiHost: ''
      })
    )

    const exaResult = await exaProvider.searchKeywords('hello', runtimeConfig)
    const tavilyResult = await tavilyProvider.searchKeywords('hello', runtimeConfig)
    const zhipuResult = await zhipuProvider.searchKeywords('hello', runtimeConfig)
    const exaMcpResult = await exaMcpProvider.searchKeywords('hello', runtimeConfig)

    expect(exaResult.results[0]?.title).toBe('')
    expect(tavilyResult.results[0]?.title).toBe('')
    expect(zhipuResult.results[0]?.title).toBe('')
    expect(exaMcpResult.results[0]?.title).toBe('')
  })
})
