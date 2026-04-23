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
  getRuntimeConfigMock,
  loggerWarnMock,
  loggerErrorMock
} = vi.hoisted(() => {
  return {
    createWebSearchProviderMock: vi.fn(),
    setWebSearchStatusMock: vi.fn().mockResolvedValue(undefined),
    clearWebSearchStatusMock: vi.fn().mockResolvedValue(undefined),
    getProviderByIdMock: vi.fn(),
    getRuntimeConfigMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    loggerErrorMock: vi.fn()
  }
})

vi.mock('./providers/factory', () => ({
  createWebSearchProvider: createWebSearchProviderMock
}))

vi.mock('@main/core/application/Application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('./runtime/status', () => ({
  setWebSearchStatus: setWebSearchStatusMock,
  clearWebSearchStatus: clearWebSearchStatusMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerWarnMock,
      error: loggerErrorMock
    })
  }
}))

vi.mock('./utils/config', () => ({
  getProviderById: getProviderByIdMock,
  getRuntimeConfig: getRuntimeConfigMock
}))

import { webSearchService } from './WebSearchService'

const provider: ResolvedWebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  apiKeys: ['key'],
  apiHost: 'https://api.tavily.com',
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
    cutoffUnit: 'char'
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

    const result = await webSearchService.search({
      providerId: 'tavily',
      questions: ['hello'],
      requestId: 'req-cutoff'
    })

    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(result.results[0].content).toBe('12345...')
    expect(setWebSearchStatusMock).toHaveBeenCalledTimes(1)
    expect(setWebSearchStatusMock).toHaveBeenNthCalledWith(1, expect.anything(), 'req-cutoff', { phase: 'cutoff' }, 500)
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith(expect.anything(), 'req-cutoff')
  })

  it('filters blacklisted results before post processing', async () => {
    getRuntimeConfigMock.mockResolvedValue({
      ...runtimeConfig,
      excludeDomains: ['https://blocked.example/*', '/evil\\.example\\/post$/']
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

    const result = await webSearchService.search({
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
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith(expect.anything(), 'req-blacklist')
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

    const result = await webSearchService.search({
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
    expect(setWebSearchStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      'req-partial-success',
      {
        phase: 'partial_failure',
        countBefore: 2,
        countAfter: 1
      },
      1000
    )
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith(expect.anything(), 'req-partial-success')
  })

  it('throws AbortError when any query is aborted even if others succeed', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
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
      .mockRejectedValueOnce(abortError)

    createWebSearchProviderMock.mockReturnValue({
      search: searchMock
    })

    await expect(
      webSearchService.search({
        providerId: 'tavily',
        questions: ['first', 'second'],
        requestId: 'req-partial-abort'
      })
    ).rejects.toBe(abortError)

    expect(setWebSearchStatusMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).not.toHaveBeenCalled()
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith(expect.anything(), 'req-partial-abort')
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

    const result = await webSearchService.search({
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
      expect.anything(),
      'req-multi-success',
      {
        phase: 'fetch_complete',
        countAfter: 2
      },
      1000
    )
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith(expect.anything(), 'req-multi-success')
  })

  it('throws when all queries fail', async () => {
    const error = new Error('network failed')
    createWebSearchProviderMock.mockReturnValue({
      search: vi.fn().mockRejectedValue(error)
    })

    await expect(
      webSearchService.search({
        providerId: 'tavily',
        questions: ['first', 'second'],
        requestId: 'req-all-failed'
      })
    ).rejects.toThrow('network failed')

    expect(loggerErrorMock).toHaveBeenCalledWith('Web search failed', error, {
      requestId: 'req-all-failed',
      providerId: 'tavily'
    })
    expect(clearWebSearchStatusMock).toHaveBeenCalledWith(expect.anything(), 'req-all-failed')
  })

  it('keeps successful results when fetch status cache write fails', async () => {
    setWebSearchStatusMock.mockRejectedValueOnce(new Error('cache write failed'))

    createWebSearchProviderMock.mockReturnValue({
      search: vi
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
    })

    const result = await webSearchService.search({
      providerId: 'tavily',
      questions: ['first', 'second'],
      requestId: 'req-status-write-failed'
    })

    expect(result.results).toHaveLength(2)
    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to update web search status', {
      requestId: 'req-status-write-failed',
      phase: 'fetch_complete',
      error: 'cache write failed'
    })
  })

  it('keeps successful response when post-processing status cache write fails', async () => {
    getRuntimeConfigMock.mockResolvedValue({
      ...runtimeConfig,
      compression: {
        ...runtimeConfig.compression,
        method: 'cutoff',
        cutoffLimit: 5,
        cutoffUnit: 'char'
      }
    })
    setWebSearchStatusMock.mockRejectedValueOnce(new Error('cache write failed'))

    createWebSearchProviderMock.mockReturnValue({
      search: vi.fn().mockResolvedValue({
        query: 'test',
        results: [
          {
            title: 'A',
            content: '1234567890',
            url: 'https://example.com'
          }
        ]
      } satisfies WebSearchResponse)
    })

    const result = await webSearchService.search({
      providerId: 'tavily',
      questions: ['hello'],
      requestId: 'req-post-process-status-failed'
    })

    expect(result.results[0].content).toBe('12345...')
    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to update web search status', {
      requestId: 'req-post-process-status-failed',
      phase: 'cutoff',
      error: 'cache write failed'
    })
  })

  it('does not let cleanup cache failures replace the original search error', async () => {
    const searchError = new Error('network failed')
    clearWebSearchStatusMock.mockRejectedValueOnce(new Error('cache cleanup failed'))
    createWebSearchProviderMock.mockReturnValue({
      search: vi.fn().mockRejectedValue(searchError)
    })

    await expect(
      webSearchService.search({
        providerId: 'tavily',
        questions: ['first'],
        requestId: 'req-clear-failed'
      })
    ).rejects.toThrow('network failed')

    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to clear web search status', {
      requestId: 'req-clear-failed',
      error: 'cache cleanup failed'
    })
  })
})
