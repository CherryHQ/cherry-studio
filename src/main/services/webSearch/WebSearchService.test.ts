import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createWebSearchProviderMock, setWebSearchStatusMock, clearWebSearchStatusMock } = vi.hoisted(() => {
  return {
    createWebSearchProviderMock: vi.fn(),
    setWebSearchStatusMock: vi.fn().mockResolvedValue(undefined),
    clearWebSearchStatusMock: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('./providers/factory', () => ({
  createWebSearchProvider: createWebSearchProviderMock
}))

vi.mock('./runtime/status', () => ({
  setWebSearchStatus: setWebSearchStatusMock,
  clearWebSearchStatus: clearWebSearchStatusMock
}))

import { WebSearchService } from './WebSearchService'

const provider: ResolvedWebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  usingBrowser: false,
  apiKey: 'key',
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
  apiKey: '',
  apiHost: 'https://www.google.com/search?q=%s',
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const runtimeConfig: WebSearchExecutionConfig = {
  searchWithTime: false,
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
  })

  it('returns empty result when no query is provided', async () => {
    const resolver = {
      getProviderById: vi.fn().mockResolvedValue(provider),
      getRuntimeConfig: vi.fn().mockResolvedValue(runtimeConfig)
    }

    const service = new WebSearchService(resolver as any)

    const result = await service.search({
      providerId: 'tavily',
      input: { question: [] },
      requestId: 'req-empty'
    })

    expect(result).toEqual({ query: '', results: [] })
    expect(createWebSearchProviderMock).not.toHaveBeenCalled()
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-empty')
  })

  it('applies cutoff post processing', async () => {
    const resolver = {
      getProviderById: vi.fn().mockResolvedValue(provider),
      getRuntimeConfig: vi.fn().mockResolvedValue({
        ...runtimeConfig,
        compression: {
          ...runtimeConfig.compression,
          method: 'cutoff',
          cutoffLimit: 5,
          cutoffUnit: 'char'
        }
      })
    }

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

    const service = new WebSearchService(resolver as any)

    const result = await service.search({
      providerId: 'tavily',
      input: { question: ['hello'] },
      requestId: 'req-cutoff'
    })

    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(result.results[0].content).toBe('12345...')
    expect(setWebSearchStatusMock).toHaveBeenCalledTimes(1)
    expect(setWebSearchStatusMock).toHaveBeenNthCalledWith(1, 'req-cutoff', { phase: 'cutoff' }, 500)
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-cutoff')
  })

  it('throws when provider is unavailable', async () => {
    const resolver = {
      getProviderById: vi.fn().mockResolvedValue(null),
      getRuntimeConfig: vi.fn().mockResolvedValue(runtimeConfig)
    }

    const service = new WebSearchService(resolver as any)

    await expect(
      service.search({
        providerId: 'tavily',
        input: { question: ['hello'] },
        requestId: 'req-missing-provider'
      })
    ).rejects.toThrow('Unsupported or unavailable provider')

    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-missing-provider')
  })

  it('supports local providers through provider factory', async () => {
    const resolver = {
      getProviderById: vi.fn().mockResolvedValue(localProvider),
      getRuntimeConfig: vi.fn().mockResolvedValue(runtimeConfig)
    }

    const searchMock = vi.fn().mockResolvedValue({
      query: 'hello',
      results: []
    } satisfies WebSearchResponse)

    createWebSearchProviderMock.mockReturnValue({
      search: searchMock
    })

    const service = new WebSearchService(resolver as any)

    await service.search({
      providerId: 'local-google',
      input: { question: ['hello'] },
      requestId: 'req-local-provider'
    })

    expect(createWebSearchProviderMock).toHaveBeenCalledWith(localProvider)
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith('req-local-provider')
  })

  it('filters blacklisted results before post processing', async () => {
    const resolver = {
      getProviderById: vi.fn().mockResolvedValue(provider),
      getRuntimeConfig: vi.fn().mockResolvedValue({
        ...runtimeConfig,
        excludeDomains: ['https://blocked.example/*', '/evil\\.example$/']
      })
    }

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

    const service = new WebSearchService(resolver as any)

    const result = await service.search({
      providerId: 'tavily',
      input: { question: ['hello'] },
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

  it('checks provider through lightweight driver check', async () => {
    const resolver = {
      getProviderById: vi.fn().mockResolvedValue(provider)
    }

    const checkMock = vi.fn().mockResolvedValue(undefined)
    const searchMock = vi.fn()
    createWebSearchProviderMock.mockReturnValue({
      check: checkMock,
      search: searchMock
    })

    const service = new WebSearchService(resolver as any)
    const result = await service.checkProvider('tavily')

    expect(result).toEqual({ valid: true, error: undefined })
    expect(createWebSearchProviderMock).toHaveBeenCalledWith(provider)
    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('returns invalid when lightweight provider check fails', async () => {
    const resolver = {
      getProviderById: vi.fn().mockResolvedValue(provider)
    }

    const error = new Error('network failed')
    createWebSearchProviderMock.mockReturnValue({
      check: vi.fn().mockRejectedValue(error),
      search: vi.fn()
    })

    const service = new WebSearchService(resolver as any)
    const result = await service.checkProvider('tavily')

    expect(result).toEqual({ valid: false, error })
  })
})
