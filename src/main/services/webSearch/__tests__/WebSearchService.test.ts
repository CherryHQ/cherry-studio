import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as WebSearchProviderFactoryModule from '../providers/factory'

const { createWebSearchProviderMock, loggerWarnMock, loggerErrorMock } = vi.hoisted(() => ({
  createWebSearchProviderMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn()
}))

vi.mock('../providers/factory', async (importOriginal) => {
  const actual = await importOriginal<typeof WebSearchProviderFactoryModule>()

  return {
    ...actual,
    createWebSearchProvider: createWebSearchProviderMock
  }
})

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

import { webSearchService } from '../WebSearchService'

const runtimeConfig: WebSearchExecutionConfig = {
  maxResults: 4,
  excludeDomains: [],
  compression: {
    method: 'none',
    cutoffLimit: 2000,
    cutoffUnit: 'char'
  }
}

const providerOverrides: ResolvedWebSearchProvider[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    apiKeys: ['key'],
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'fetch',
    name: 'Fetch',
    type: 'api',
    apiKeys: [],
    capabilities: [{ feature: 'fetchUrls', apiHost: '' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'jina',
    name: 'Jina',
    type: 'api',
    apiKeys: ['jina-key'],
    capabilities: [
      { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
      { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
    ],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  }
]

function response(
  providerId: ResolvedWebSearchProvider['id'],
  capability: WebSearchResponse['capability'],
  input: string,
  results: Array<{ title: string; content: string; url: string; sourceInput?: string }>
): WebSearchResponse {
  return {
    query: input,
    providerId,
    capability,
    inputs: [input],
    results: results.map((result) => ({
      ...result,
      sourceInput: result.sourceInput ?? input
    }))
  }
}

function setWebSearchPreferences(
  values: Partial<{
    defaultSearchKeywordsProvider: ResolvedWebSearchProvider['id'] | null
    defaultFetchUrlsProvider: ResolvedWebSearchProvider['id'] | null
    runtimeConfig: Partial<WebSearchExecutionConfig>
  }> = {}
) {
  MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
    'chat.web_search.default_search_keywords_provider':
      values.defaultSearchKeywordsProvider === undefined ? 'tavily' : values.defaultSearchKeywordsProvider,
    'chat.web_search.default_fetch_urls_provider':
      values.defaultFetchUrlsProvider === undefined ? 'fetch' : values.defaultFetchUrlsProvider,
    'chat.web_search.max_results': values.runtimeConfig?.maxResults ?? runtimeConfig.maxResults,
    'chat.web_search.exclude_domains': values.runtimeConfig?.excludeDomains ?? runtimeConfig.excludeDomains,
    'chat.web_search.compression.method': values.runtimeConfig?.compression?.method ?? runtimeConfig.compression.method,
    'chat.web_search.compression.cutoff_limit':
      values.runtimeConfig?.compression?.cutoffLimit ?? runtimeConfig.compression.cutoffLimit,
    'chat.web_search.compression.cutoff_unit':
      values.runtimeConfig?.compression?.cutoffUnit ?? runtimeConfig.compression.cutoffUnit,
    'chat.web_search.provider_overrides': Object.fromEntries(
      providerOverrides.map((provider) => [
        provider.id,
        {
          apiKeys: provider.apiKeys,
          capabilities: Object.fromEntries(
            provider.capabilities.map((capability) => [capability.feature, { apiHost: capability.apiHost }])
          ),
          engines: provider.engines,
          basicAuthUsername: provider.basicAuthUsername,
          basicAuthPassword: provider.basicAuthPassword
        }
      ])
    )
  })
}

describe('WebSearchService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    setWebSearchPreferences()
  })

  it('uses the keyword default provider and returns service-owned response metadata', async () => {
    const searchKeywords = vi
      .fn()
      .mockImplementation((input: string) =>
        Promise.resolve(
          response('tavily', 'searchKeywords', input, [{ title: input, content: 'ok', url: `https://${input}.test` }])
        )
      )
    createWebSearchProviderMock.mockReturnValue({ searchKeywords })

    const result = await webSearchService.searchKeywords({ keywords: [' first ', 'second'] })

    expect(createWebSearchProviderMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'tavily' }))
    expect(searchKeywords).toHaveBeenNthCalledWith(1, 'first', expect.objectContaining({ maxResults: 4 }), undefined)
    expect(searchKeywords).toHaveBeenNthCalledWith(2, 'second', expect.objectContaining({ maxResults: 4 }), undefined)
    expect(result).toEqual({
      query: 'first | second',
      providerId: 'tavily',
      capability: 'searchKeywords',
      inputs: ['first', 'second'],
      results: [
        { title: 'first', content: 'ok', url: 'https://first.test', sourceInput: 'first' },
        { title: 'second', content: 'ok', url: 'https://second.test', sourceInput: 'second' }
      ]
    })
  })

  it('uses explicit provider overrides and supports Jina for both capabilities', async () => {
    const searchKeywords = vi
      .fn()
      .mockResolvedValue(
        response('jina', 'searchKeywords', 'news', [{ title: 'News', content: 'ok', url: 'https://news.test' }])
      )
    const fetchUrls = vi
      .fn()
      .mockResolvedValue(
        response('jina', 'fetchUrls', 'https://example.com', [
          { title: 'Example', content: 'page', url: 'https://example.com' }
        ])
      )
    createWebSearchProviderMock.mockReturnValue({ searchKeywords, fetchUrls })

    await expect(webSearchService.searchKeywords({ providerId: 'jina', keywords: ['news'] })).resolves.toMatchObject({
      providerId: 'jina',
      capability: 'searchKeywords'
    })
    await expect(
      webSearchService.fetchUrls({ providerId: 'jina', urls: ['https://example.com'] })
    ).resolves.toMatchObject({
      providerId: 'jina',
      capability: 'fetchUrls'
    })
  })

  it('returns partial successes and logs non-abort input failures', async () => {
    const searchKeywords = vi
      .fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(
        response('tavily', 'searchKeywords', 'second', [
          { title: 'Recovered', content: 'ok', url: 'https://example.com/recovered' }
        ])
      )
    createWebSearchProviderMock.mockReturnValue({ searchKeywords })

    const result = await webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first', 'second'] })

    expect(result).toEqual({
      query: 'first | second',
      providerId: 'tavily',
      capability: 'searchKeywords',
      inputs: ['first', 'second'],
      results: [
        {
          title: 'Recovered',
          content: 'ok',
          url: 'https://example.com/recovered',
          sourceInput: 'second'
        }
      ]
    })
    expect(loggerWarnMock).toHaveBeenCalledWith('Partial web search input failed', {
      providerId: 'tavily',
      capability: 'searchKeywords',
      input: 'first',
      error: 'network failed'
    })
  })

  it('throws AbortError without logging service failures', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const searchKeywords = vi
      .fn()
      .mockResolvedValueOnce(
        response('tavily', 'searchKeywords', 'first', [
          { title: 'First', content: 'one', url: 'https://example.com/first' }
        ])
      )
      .mockRejectedValueOnce(abortError)
    createWebSearchProviderMock.mockReturnValue({ searchKeywords })

    await expect(webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first', 'second'] })).rejects.toBe(
      abortError
    )

    expect(loggerWarnMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('throws when every input fails and logs the service failure', async () => {
    const error = new Error('network failed')
    createWebSearchProviderMock.mockReturnValue({
      searchKeywords: vi.fn().mockRejectedValue(error)
    })

    await expect(
      webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first', 'second'] })
    ).rejects.toThrow('network failed')

    expect(loggerErrorMock).toHaveBeenCalledWith('Web search failed', error, {
      providerId: 'tavily',
      capability: 'searchKeywords'
    })
  })

  it('filters blacklisted results before cutoff post processing', async () => {
    setWebSearchPreferences({
      runtimeConfig: {
        excludeDomains: ['https://blocked.example/*'],
        compression: {
          method: 'cutoff',
          cutoffLimit: 5,
          cutoffUnit: 'char'
        }
      }
    })
    createWebSearchProviderMock.mockReturnValue({
      searchKeywords: vi.fn().mockResolvedValue(
        response('tavily', 'searchKeywords', 'hello', [
          { title: 'Blocked', content: 'blocked', url: 'https://blocked.example/post' },
          { title: 'Allowed', content: '1234567890', url: 'https://allowed.example/post' }
        ])
      )
    })

    const result = await webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['hello'] })

    expect(result.results).toEqual([
      {
        title: 'Allowed',
        content: '12345...',
        url: 'https://allowed.example/post',
        sourceInput: 'hello'
      }
    ])
  })

  it('uses the fetch URL default provider and validates URL inputs', async () => {
    const fetchUrls = vi.fn().mockImplementation((input: string) =>
      Promise.resolve(
        response('fetch', 'fetchUrls', input, [
          {
            title: input,
            content: 'content',
            url: input
          }
        ])
      )
    )
    createWebSearchProviderMock.mockReturnValue({ fetchUrls })

    const result = await webSearchService.fetchUrls({ urls: [' https://example.com/first '] })

    expect(createWebSearchProviderMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'fetch' }))
    expect(fetchUrls).toHaveBeenCalledWith('https://example.com/first', expect.any(Object), undefined)
    expect(result).toEqual({
      query: 'https://example.com/first',
      providerId: 'fetch',
      capability: 'fetchUrls',
      inputs: ['https://example.com/first'],
      results: [
        {
          title: 'https://example.com/first',
          content: 'content',
          url: 'https://example.com/first',
          sourceInput: 'https://example.com/first'
        }
      ]
    })

    await expect(webSearchService.fetchUrls({ urls: ['not a url'] })).rejects.toThrow('Invalid URL format: not a url')
  })

  it('throws when a default provider is not configured or does not support the requested capability', async () => {
    setWebSearchPreferences({ defaultSearchKeywordsProvider: null })

    await expect(webSearchService.searchKeywords({ keywords: ['hello'] })).rejects.toThrow(
      'Default web search provider is not configured for capability searchKeywords'
    )

    setWebSearchPreferences({ defaultSearchKeywordsProvider: 'fetch' })

    await expect(webSearchService.searchKeywords({ keywords: ['hello'] })).rejects.toThrow(
      'Web search provider fetch does not support capability searchKeywords'
    )
  })
})
