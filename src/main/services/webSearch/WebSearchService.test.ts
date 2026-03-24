import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createWebSearchProviderMock,
  setWebSearchStatusMock,
  clearWebSearchStatusMock,
  getProviderByIdMock,
  getRuntimeConfigMock
} = vi.hoisted(() => {
  return {
    createWebSearchProviderMock: vi.fn(),
    setWebSearchStatusMock: vi.fn().mockResolvedValue(undefined),
    clearWebSearchStatusMock: vi.fn().mockResolvedValue(undefined),
    getProviderByIdMock: vi.fn(),
    getRuntimeConfigMock: vi.fn()
  }
})

vi.mock('./providers/factory', () => ({
  createWebSearchProvider: createWebSearchProviderMock
}))

vi.mock('./runtime/status', () => ({
  setWebSearchStatus: setWebSearchStatusMock,
  clearWebSearchStatus: clearWebSearchStatusMock
}))

vi.mock('./utils/config', () => ({
  getProviderById: getProviderByIdMock,
  getRuntimeConfig: getRuntimeConfigMock
}))

import { WebSearchService } from './WebSearchService'

const provider: ResolvedWebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  usingBrowser: false,
  apiKeys: ['key'],
  apiHost: 'https://api.tavily.com',
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const localProvider: ResolvedWebSearchProvider = {
  id: 'local-google',
  name: 'Google',
  type: 'local',
  usingBrowser: true,
  apiKeys: [],
  apiHost: 'https://www.google.com/search?q=%s',
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const runtimeConfig: WebSearchExecutionConfig = {
  maxResults: 4,
  excludeDomains: [],
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

describe('WebSearchService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderByIdMock.mockResolvedValue(provider)
    getRuntimeConfigMock.mockResolvedValue(runtimeConfig)
  })

  it('applies cutoff post processing', async () => {
    getRuntimeConfigMock.mockResolvedValue({
      ...runtimeConfig,
      compression: {
        ...runtimeConfig.compression,
        method: 'cutoff',
        cutoffLimit: 5,
        cutoffUnit: 'char'
      }
    })

    const searchMock = vi.fn().mockResolvedValue({
      query: 'test',
      results: [
        {
          title: 'A',
          content: '1234567890',
          url: 'https://example.com'
        }
      ]
    } satisfies WebSearchResponse)

    createWebSearchProviderMock.mockReturnValue({
      search: searchMock
    })

    const service = WebSearchService.getInstance()

    const result = await service.search({
      providerId: 'tavily',
      questions: ['hello'],
      requestId: 'req-cutoff'
    })

    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(result.results[0].content).toBe('12345...')
    expect(setWebSearchStatusMock).toHaveBeenCalledTimes(1)
    expect(setWebSearchStatusMock).toHaveBeenNthCalledWith(1, 'req-cutoff', { phase: 'cutoff' }, 500)
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-cutoff')
  })

  it('supports local providers through provider factory', async () => {
    getProviderByIdMock.mockResolvedValue(localProvider)

    const searchMock = vi.fn().mockResolvedValue({
      query: 'hello',
      results: []
    } satisfies WebSearchResponse)

    createWebSearchProviderMock.mockReturnValue({
      search: searchMock
    })

    const service = WebSearchService.getInstance()

    await service.search({
      providerId: 'local-google',
      questions: ['hello'],
      requestId: 'req-local-provider'
    })

    expect(createWebSearchProviderMock).toHaveBeenCalledWith(localProvider)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-local-provider')
  })

  it('filters blacklisted results before post processing', async () => {
    getRuntimeConfigMock.mockResolvedValue({
      ...runtimeConfig,
      excludeDomains: ['https://blocked.example/*', '/evil\\.example$/']
    })

    createWebSearchProviderMock.mockReturnValue({
      search: vi.fn().mockResolvedValue({
        query: 'hello',
        results: [
          {
            title: 'Blocked by match pattern',
            content: 'blocked',
            url: 'https://blocked.example/post'
          },
          {
            title: 'Blocked by regex',
            content: 'blocked',
            url: 'https://evil.example/post'
          },
          {
            title: 'Allowed',
            content: 'allowed',
            url: 'https://allowed.example/post'
          }
        ]
      } satisfies WebSearchResponse)
    })

    const service = WebSearchService.getInstance()

    const result = await service.search({
      providerId: 'tavily',
      questions: ['hello'],
      requestId: 'req-blacklist'
    })

    expect(result.results).toEqual([
      {
        title: 'Allowed',
        content: 'allowed',
        url: 'https://allowed.example/post'
      }
    ])
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-blacklist')
  })

  it('returns partial results when some queries fail', async () => {
    const searchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce({
        query: 'second-query',
        results: [
          {
            title: 'Recovered',
            content: 'ok',
            url: 'https://example.com/recovered'
          }
        ]
      } satisfies WebSearchResponse)

    createWebSearchProviderMock.mockReturnValue({
      search: searchMock
    })

    const service = WebSearchService.getInstance()
    const result = await service.search({
      providerId: 'tavily',
      questions: ['first', 'second'],
      requestId: 'req-partial-success'
    })

    expect(result).toEqual({
      query: 'first | second',
      results: [
        {
          title: 'Recovered',
          content: 'ok',
          url: 'https://example.com/recovered'
        }
      ]
    })
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-partial-success')
  })

  it('merges multiple successful searches and updates fetch status with narrowed fulfilled results', async () => {
    const searchMock = vi
      .fn()
      .mockResolvedValueOnce({
        query: 'first-query',
        results: [
          {
            title: 'First',
            content: 'one',
            url: 'https://example.com/first'
          }
        ]
      } satisfies WebSearchResponse)
      .mockResolvedValueOnce({
        query: 'second-query',
        results: [
          {
            title: 'Second',
            content: 'two',
            url: 'https://example.com/second'
          }
        ]
      } satisfies WebSearchResponse)

    createWebSearchProviderMock.mockReturnValue({
      search: searchMock
    })

    const service = WebSearchService.getInstance()
    const result = await service.search({
      providerId: 'tavily',
      questions: ['first', 'second'],
      requestId: 'req-multi-success'
    })

    expect(result).toEqual({
      query: 'first | second',
      results: [
        {
          title: 'First',
          content: 'one',
          url: 'https://example.com/first'
        },
        {
          title: 'Second',
          content: 'two',
          url: 'https://example.com/second'
        }
      ]
    })
    expect(setWebSearchStatusMock).toHaveBeenCalledWith(
      'req-multi-success',
      {
        phase: 'fetch_complete',
        countAfter: 2
      },
      1000
    )
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-multi-success')
  })

  it('throws when all queries fail', async () => {
    const error = new Error('network failed')
    createWebSearchProviderMock.mockReturnValue({
      search: vi.fn().mockRejectedValue(error)
    })

    const service = WebSearchService.getInstance()

    await expect(
      service.search({
        providerId: 'tavily',
        questions: ['first', 'second'],
        requestId: 'req-all-failed'
      })
    ).rejects.toThrow('network failed')

    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-all-failed')
  })
})
