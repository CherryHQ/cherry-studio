import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.stubGlobal('keyv', {
  get: vi.fn(),
  set: vi.fn()
})

import BochaProvider from '../BochaProvider'

function createProvider() {
  return new BochaProvider({
    id: 'bocha',
    name: 'Bocha',
    apiHost: 'https://api.bochaai.com',
    apiKey: 'test-key'
  } as any)
}

const defaultWebsearch = {
  maxResults: 5,
  excludeDomains: ['example.com', 'foo.bar'],
  searchWithTime: true
} as any

describe('BochaProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends supported request params without page', async () => {
    const provider = createProvider()

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        log_id: 'test-log-id',
        msg: null,
        data: {
          _type: 'SearchResponse',
          queryContext: {
            originalQuery: '阿里巴巴2024年的esg报告'
          },
          webPages: {
            webSearchUrl: '',
            totalEstimatedMatches: 1,
            value: [
              {
                id: null,
                name: '结果标题',
                url: 'https://example.com/result',
                displayUrl: 'https://example.com/result',
                snippet: '摘要片段',
                siteName: 'example.com',
                siteIcon: 'https://example.com/favicon.ico',
                dateLastCrawled: '2024-07-22T00:00:00Z',
                cachedPageUrl: null,
                language: null,
                isFamilyFriendly: null,
                isNavigational: null
              }
            ],
            someResultsRemoved: true
          },
          images: {
            id: null,
            readLink: null,
            webSearchUrl: null,
            isFamilyFriendly: null,
            value: []
          },
          videos: null
        }
      })
    } as Response)

    await provider.search('阿里巴巴2024年的esg报告', defaultWebsearch)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String(requestInit?.body))

    expect(body).toEqual({
      query: '阿里巴巴2024年的esg报告',
      count: 5,
      exclude: 'example.com,foo.bar',
      freshness: 'oneDay',
      summary: true
    })
    expect(body).not.toHaveProperty('page')
  })

  it('maps latest response fields into search results', async () => {
    const provider = createProvider()

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        log_id: 'test-log-id',
        msg: null,
        data: {
          _type: 'SearchResponse',
          queryContext: {
            originalQuery: '测试查询'
          },
          webPages: {
            webSearchUrl: '',
            totalEstimatedMatches: 2,
            value: [
              {
                id: null,
                name: '第一条结果',
                url: 'https://example.com/1',
                displayUrl: 'https://example.com/1',
                snippet: '第一条 snippet',
                summary: '第一条 summary',
                siteName: 'example.com',
                siteIcon: 'https://example.com/favicon.ico',
                dateLastCrawled: '2024-07-22T00:00:00Z',
                cachedPageUrl: null,
                language: null,
                isFamilyFriendly: null,
                isNavigational: null
              },
              {
                id: null,
                name: '第二条结果',
                url: 'https://example.com/2',
                displayUrl: 'https://example.com/2',
                snippet: '第二条 snippet',
                siteName: 'example.com',
                siteIcon: 'https://example.com/favicon.ico',
                dateLastCrawled: '2024-07-22T00:00:00Z',
                cachedPageUrl: null,
                language: null,
                isFamilyFriendly: null,
                isNavigational: null
              }
            ],
            someResultsRemoved: true
          },
          images: {
            id: null,
            readLink: null,
            webSearchUrl: null,
            isFamilyFriendly: null,
            value: []
          },
          videos: null
        }
      })
    } as Response)

    const result = await provider.search('测试查询', defaultWebsearch)

    expect(result).toEqual({
      query: '测试查询',
      results: [
        {
          title: '第一条结果',
          content: '第一条 summary',
          url: 'https://example.com/1'
        },
        {
          title: '第二条结果',
          content: '第二条 snippet',
          url: 'https://example.com/2'
        }
      ]
    })
  })
})
