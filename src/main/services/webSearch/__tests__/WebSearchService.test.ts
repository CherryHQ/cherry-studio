import { BaseService } from '@main/core/lifecycle'
import type * as RemoteUrlSafetyModule from '@main/utils/remoteUrlSafety'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as WebSearchProviderFactoryModule from '../providers/factory'

const {
  createWebSearchProviderMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
  sanitizeRemoteUrlMock,
  resolveRemoteFetchUrlMock
} = vi.hoisted(() => ({
  createWebSearchProviderMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  sanitizeRemoteUrlMock: vi.fn(),
  resolveRemoteFetchUrlMock: vi.fn()
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
      info: loggerInfoMock,
      warn: loggerWarnMock,
      error: loggerErrorMock
    })
  }
}))

vi.mock('@main/utils/remoteUrlSafety', async (importOriginal) => {
  const actual = await importOriginal<typeof RemoteUrlSafetyModule>()

  return {
    ...actual,
    sanitizeRemoteUrl: sanitizeRemoteUrlMock,
    resolveRemoteFetchUrl: resolveRemoteFetchUrlMock
  }
})

vi.mock('@main/services/readableContent', () => ({
  readableContentService: { extractReadableMarkdown: vi.fn() }
}))

import { WebSearchService } from '../WebSearchService'

const runtimeConfig: WebSearchExecutionConfig = {
  maxResults: 4,
  excludeDomains: [],
  compression: {
    method: 'none',
    cutoffLimit: 2000
  }
}

const providerOverrides: WebSearchProvider[] = [
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
    name: 'fetch',
    type: 'api',
    apiKeys: [],
    capabilities: [{ feature: 'fetchUrls' }],
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
  },
  {
    id: 'querit',
    name: 'Querit',
    type: 'api',
    apiKeys: ['querit-key'],
    capabilities: [
      { feature: 'searchKeywords', apiHost: 'https://api.querit.ai' },
      { feature: 'fetchUrls', apiHost: 'https://api.querit.ai' }
    ],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  }
]

function response(
  providerId: WebSearchProvider['id'],
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
    defaultSearchKeywordsProvider: WebSearchProvider['id'] | null
    defaultFetchUrlsProvider: WebSearchProvider['id'] | null
    providerApiKeys: Partial<Record<WebSearchProvider['id'], string[]>>
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
    'chat.web_search.provider_overrides': Object.fromEntries(
      providerOverrides.map((provider) => [
        provider.id,
        {
          apiKeys: values.providerApiKeys?.[provider.id] ?? provider.apiKeys,
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
  let webSearchService: WebSearchService

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    sanitizeRemoteUrlMock.mockImplementation((input: string) => input)
    MockMainPreferenceServiceUtils.resetMocks()
    setWebSearchPreferences()
    webSearchService = new WebSearchService()
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

    expect(createWebSearchProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tavily' }),
      expect.any(Object)
    )
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

  it('clears service-owned API key rotation state on stop', async () => {
    const searchKeywords = vi
      .fn()
      .mockResolvedValue(
        response('tavily', 'searchKeywords', 'hello', [{ title: 'Hello', content: 'ok', url: 'https://hello.test' }])
      )
    createWebSearchProviderMock.mockReturnValue({ searchKeywords })

    await webSearchService._doInit()
    await webSearchService.searchKeywords({ keywords: ['hello'] })

    const rotationState = createWebSearchProviderMock.mock.calls[0]?.[1]
    expect(rotationState).toBeDefined()
    const clearSpy = vi.spyOn(rotationState, 'clear')

    await webSearchService._doStop()

    expect(clearSpy).toHaveBeenCalledOnce()
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
    const tavilySearch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(
        response('tavily', 'searchKeywords', 'second', [
          { title: 'Recovered', content: 'ok', url: 'https://example.com/recovered' }
        ])
      )
    const exaMcpSearch = vi.fn().mockRejectedValue(new Error('ExaMCP failed'))
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'tavily' ? { searchKeywords: tavilySearch } : { searchKeywords: exaMcpSearch }
    )

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
      error: 'Web search failed after fallback: network failed; ExaMCP failed'
    })
  })

  it('skips an unconfigured keyword provider and runs every input through ExaMCP', async () => {
    setWebSearchPreferences({ providerApiKeys: { tavily: [] } })
    const tavilySearch = vi.fn()
    const exaMcpSearch = vi.fn((input: string) =>
      Promise.resolve(
        response('exa-mcp', 'searchKeywords', input, [
          { title: `Fallback ${input}`, content: 'exa', url: `https://exa.test/${input}` }
        ])
      )
    )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'tavily' ? { searchKeywords: tavilySearch } : { searchKeywords: exaMcpSearch }
    )

    const result = await webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first', 'second'] })

    expect(tavilySearch).not.toHaveBeenCalled()
    expect(exaMcpSearch).toHaveBeenCalledTimes(2)
    expect(result.providerId).toBe('exa-mcp')
    expect(result.results.map(({ title }) => title)).toEqual(['Fallback first', 'Fallback second'])
  })

  it('surfaces the selected provider configuration error when fallback is disabled', async () => {
    setWebSearchPreferences({ providerApiKeys: { tavily: [] } })
    const searchKeywords = vi.fn()
    createWebSearchProviderMock.mockReturnValue({ searchKeywords })

    await expect(
      webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first'] }, undefined, { fallback: false })
    ).rejects.toMatchObject({ name: 'WebSearchConfigError', code: 'api_key_missing' })

    expect(createWebSearchProviderMock).toHaveBeenCalledOnce()
    expect(searchKeywords).not.toHaveBeenCalled()
  })

  it('surfaces a configuration error when the selected keyword provider and fallback are both misconfigured', async () => {
    const overrides = MockMainPreferenceServiceUtils.getPreferenceValue('chat.web_search.provider_overrides')
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.web_search.provider_overrides', {
      ...overrides,
      tavily: { ...overrides.tavily, apiKeys: [] },
      'exa-mcp': {
        capabilities: {
          searchKeywords: { apiHost: 'invalid-url' }
        }
      }
    })

    await expect(webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first'] })).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'api_key_missing'
    })
  })

  it('retries only failed keywords through ExaMCP and preserves input order', async () => {
    const tavilySearch = vi.fn((input: string) =>
      input === 'first'
        ? Promise.resolve(
            response('tavily', 'searchKeywords', input, [
              { title: 'First', content: 'tavily', url: 'https://tavily.test/first' }
            ])
          )
        : Promise.reject(new Error(`Tavily failed: ${input}`))
    )
    const exaMcpSearch = vi.fn((input: string) =>
      Promise.resolve(
        response('exa-mcp', 'searchKeywords', input, [
          { title: 'Second', content: 'exa', url: 'https://exa.test/second' }
        ])
      )
    )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'tavily' ? { searchKeywords: tavilySearch } : { searchKeywords: exaMcpSearch }
    )

    const result = await webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first', 'second'] })

    expect(exaMcpSearch).toHaveBeenCalledOnce()
    expect(exaMcpSearch).toHaveBeenCalledWith('second', expect.any(Object), undefined)
    expect(result.providerId).toBe('exa-mcp')
    expect(result.providerIds).toEqual(['tavily', 'exa-mcp'])
    expect(result.results.map(({ title }) => title)).toEqual(['First', 'Second'])
  })

  it('does not start another fallback when ExaMCP itself fails', async () => {
    const error = new Error('ExaMCP failed')
    const exaMcpSearch = vi.fn().mockRejectedValue(error)
    createWebSearchProviderMock.mockReturnValue({ searchKeywords: exaMcpSearch })

    await expect(webSearchService.searchKeywords({ providerId: 'exa-mcp', keywords: ['first'] })).rejects.toBe(error)

    expect(createWebSearchProviderMock).toHaveBeenCalledOnce()
    expect(exaMcpSearch).toHaveBeenCalledOnce()
  })

  it('does not fall back from a successful empty keyword response', async () => {
    const tavilySearch = vi.fn().mockResolvedValue(response('tavily', 'searchKeywords', 'empty', []))
    createWebSearchProviderMock.mockReturnValue({ searchKeywords: tavilySearch })

    const result = await webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['empty'] })

    expect(result.results).toEqual([])
    expect(createWebSearchProviderMock).toHaveBeenCalledOnce()
  })

  it('throws AbortError without logging service failures', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const abortController = new AbortController()
    abortController.abort(abortError)
    const searchKeywords = vi.fn()
    createWebSearchProviderMock.mockReturnValue({ searchKeywords })

    await expect(
      webSearchService.searchKeywords(
        { providerId: 'tavily', keywords: ['first', 'second'] },
        {
          signal: abortController.signal
        }
      )
    ).rejects.toBe(abortError)

    expect(loggerWarnMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).not.toHaveBeenCalled()
    expect(searchKeywords).not.toHaveBeenCalled()
  })

  it('falls back when a provider input aborts without a caller-aborted signal', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const tavilySearch = vi
      .fn()
      .mockResolvedValueOnce(
        response('tavily', 'searchKeywords', 'first', [
          { title: 'First', content: 'one', url: 'https://example.com/first' }
        ])
      )
      .mockRejectedValueOnce(abortError)
    const exaMcpSearch = vi
      .fn()
      .mockResolvedValue(
        response('exa-mcp', 'searchKeywords', 'second', [
          { title: 'Second', content: 'two', url: 'https://example.com/second' }
        ])
      )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'tavily' ? { searchKeywords: tavilySearch } : { searchKeywords: exaMcpSearch }
    )

    const result = await webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first', 'second'] })

    expect(result.results.map(({ title }) => title)).toEqual(['First', 'Second'])
    expect(loggerInfoMock).toHaveBeenCalledWith('Web search fallback recovered failed inputs', {
      primaryProviderId: 'tavily',
      fallbackProviderId: 'exa-mcp',
      recoveredInputs: 1
    })
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('logs service failures for abort errors when the caller did not abort', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    createWebSearchProviderMock.mockReturnValue({
      searchKeywords: vi.fn().mockRejectedValue(abortError)
    })

    await expect(webSearchService.searchKeywords({ providerId: 'exa-mcp', keywords: ['first'] })).rejects.toBe(
      abortError
    )

    expect(loggerErrorMock).toHaveBeenCalledWith('Web search failed', abortError, {
      providerId: 'exa-mcp',
      capability: 'searchKeywords'
    })
  })

  it('aggregates keyword provider failures when every fallback input fails', async () => {
    const primaryError = new Error('network failed')
    const fallbackError = new Error('ExaMCP failed')
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) => ({
      searchKeywords: vi.fn().mockRejectedValue(provider.id === 'tavily' ? primaryError : fallbackError)
    }))

    await expect(
      webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['first', 'second'] })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AggregateError &&
        error.message.includes('network failed') &&
        error.message.includes('ExaMCP failed') &&
        error.errors.includes(primaryError) &&
        error.errors.includes(fallbackError)
    )

    expect(loggerErrorMock).toHaveBeenCalledWith('Web search failed', expect.any(AggregateError), {
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
          cutoffLimit: 5
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
        content: '1234567890',
        url: 'https://allowed.example/post',
        sourceInput: 'hello'
      }
    ])
  })

  it('returns unprocessed fetch results without blacklist filtering or cutoff', async () => {
    setWebSearchPreferences({
      runtimeConfig: {
        excludeDomains: ['https://blocked.example/*'],
        compression: {
          method: 'cutoff',
          cutoffLimit: 5
        }
      }
    })
    createWebSearchProviderMock.mockReturnValue({
      fetchUrls: vi.fn().mockResolvedValue(
        response('jina', 'fetchUrls', 'https://blocked.example/post', [
          {
            title: 'Blocked',
            content: 'complete knowledge content',
            url: 'https://blocked.example/post'
          }
        ])
      )
    })

    const result = await webSearchService.fetchUrlsUnprocessed({
      providerId: 'jina',
      urls: ['https://blocked.example/post']
    })

    expect(result.results).toEqual([
      {
        title: 'Blocked',
        content: 'complete knowledge content',
        url: 'https://blocked.example/post',
        sourceInput: 'https://blocked.example/post'
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

    expect(createWebSearchProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fetch' }),
      expect.any(Object)
    )
    expect(fetchUrls).toHaveBeenCalledWith('https://example.com/first', expect.any(Object), undefined)
    expect(createWebSearchProviderMock).toHaveBeenCalledTimes(1)
    expect(sanitizeRemoteUrlMock).not.toHaveBeenCalled()
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

  it('skips an unconfigured URL provider and fetches every URL through Cherry Fetch', async () => {
    setWebSearchPreferences({ providerApiKeys: { querit: [] } })
    const queritFetch = vi.fn()
    const cherryFetch = vi.fn((input: string) =>
      Promise.resolve(response('fetch', 'fetchUrls', input, [{ title: input, content: 'cherry', url: input }]))
    )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'querit' ? { fetchUrls: queritFetch } : { fetchUrls: cherryFetch }
    )

    const result = await webSearchService.fetchUrls({
      providerId: 'querit',
      urls: ['https://example.com/first', 'https://example.com/second']
    })

    expect(queritFetch).not.toHaveBeenCalled()
    expect(cherryFetch).toHaveBeenCalledTimes(2)
    expect(result.providerId).toBe('fetch')
    expect(result.results.map(({ content }) => content)).toEqual(['cherry', 'cherry'])
  })

  it('retries a failed configured URL provider through Cherry Fetch', async () => {
    const queritFetch = vi.fn().mockRejectedValue(new Error('Querit failed'))
    const cherryFetch = vi
      .fn()
      .mockResolvedValue(
        response('fetch', 'fetchUrls', 'https://example.com/article', [
          { title: 'Recovered', content: 'cherry', url: 'https://example.com/article' }
        ])
      )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'querit' ? { fetchUrls: queritFetch } : { fetchUrls: cherryFetch }
    )

    const result = await webSearchService.fetchUrls({
      providerId: 'querit',
      urls: ['https://example.com/article']
    })

    expect(cherryFetch).toHaveBeenCalledOnce()
    expect(result.results[0]?.title).toBe('Recovered')
  })

  it('continues from a failed Cherry Fetch fallback to Jina', async () => {
    const primaryError = new Error('Querit failed')
    const fallbackError = new Error('Cherry Fetch failed')
    const queritFetch = vi.fn().mockRejectedValue(primaryError)
    const cherryFetch = vi.fn().mockRejectedValue(fallbackError)
    const jinaFetch = vi
      .fn()
      .mockResolvedValue(
        response('jina', 'fetchUrls', 'https://example.com/article', [
          { title: 'Recovered', content: 'Jina content', url: 'https://example.com/article' }
        ])
      )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) => {
      if (provider.id === 'querit') return { fetchUrls: queritFetch }
      if (provider.id === 'fetch') return { fetchUrls: cherryFetch }
      return { fetchUrls: jinaFetch }
    })

    const result = await webSearchService.fetchUrls({
      providerId: 'querit',
      urls: ['https://example.com/article']
    })

    expect(jinaFetch).toHaveBeenCalledOnce()
    expect(result.providerId).toBe('jina')
    expect(result.results[0]?.title).toBe('Recovered')
  })

  it('falls back from native fetch to Jina after passing the failed hostname through the literal URL guard', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.fetch.allow_private_network', false)
    const primaryError = new Error('native failed')
    const nativeFetch = vi.fn().mockRejectedValue(primaryError)
    const jinaFetch = vi
      .fn()
      .mockResolvedValue(
        response('jina', 'fetchUrls', 'https://example.com/article', [
          { title: 'Recovered', content: 'Jina content', url: 'https://example.com/article' }
        ])
      )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'fetch' ? { fetchUrls: nativeFetch } : { fetchUrls: jinaFetch }
    )

    const result = await webSearchService.fetchUrlsUnprocessed({ urls: ['https://fake-ip.example/article'] })

    expect(sanitizeRemoteUrlMock).toHaveBeenCalledWith('https://fake-ip.example/article', undefined, false)
    expect(resolveRemoteFetchUrlMock).not.toHaveBeenCalled()
    expect(jinaFetch).toHaveBeenCalledWith('https://fake-ip.example/article', expect.any(Object), undefined)
    expect(result.results).toEqual([
      {
        title: 'Recovered',
        content: 'Jina content',
        url: 'https://example.com/article',
        sourceInput: 'https://fake-ip.example/article'
      }
    ])
    expect(loggerInfoMock).toHaveBeenCalledWith('Web fetch fallback recovered failed inputs', {
      primaryProviderId: 'fetch',
      fallbackProviderId: 'jina',
      recoveredInputs: 1
    })
  })

  it('falls back from Jina to native fetch without repeating the Jina safety gate', async () => {
    const jinaFetch = vi.fn().mockRejectedValue(new Error('Jina failed'))
    const nativeFetch = vi
      .fn()
      .mockResolvedValue(
        response('fetch', 'fetchUrls', 'https://example.com/article', [
          { title: 'Recovered', content: 'Native content', url: 'https://example.com/article' }
        ])
      )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'jina' ? { fetchUrls: jinaFetch } : { fetchUrls: nativeFetch }
    )

    const result = await webSearchService.fetchUrls({ providerId: 'jina', urls: ['https://example.com/article'] })

    expect(nativeFetch).toHaveBeenCalledWith('https://example.com/article', expect.any(Object), undefined)
    expect(sanitizeRemoteUrlMock).not.toHaveBeenCalled()
    expect(result.providerId).toBe('fetch')
    expect(result.results).toHaveLength(1)
  })

  it('retries only failed inputs and preserves the input result order', async () => {
    const nativeFetch = vi.fn((input: string) => {
      if (input === 'https://example.com/first') {
        return Promise.resolve(
          response('fetch', 'fetchUrls', input, [{ title: 'First', content: 'native', url: input }])
        )
      }

      return Promise.reject(new Error(`native failed: ${input}`))
    })
    const jinaFetch = vi.fn((input: string) => {
      if (input === 'https://example.com/second') {
        return Promise.resolve(response('jina', 'fetchUrls', input, [{ title: 'Second', content: 'jina', url: input }]))
      }

      return Promise.reject(new Error(`Jina failed: ${input}`))
    })
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'fetch' ? { fetchUrls: nativeFetch } : { fetchUrls: jinaFetch }
    )

    const result = await webSearchService.fetchUrls({
      urls: ['https://example.com/first', 'https://example.com/second', 'https://example.com/third']
    })

    expect(jinaFetch).toHaveBeenCalledTimes(2)
    expect(jinaFetch).toHaveBeenNthCalledWith(1, 'https://example.com/second', expect.any(Object), undefined)
    expect(jinaFetch).toHaveBeenNthCalledWith(2, 'https://example.com/third', expect.any(Object), undefined)
    expect(result.providerId).toBe('jina')
    expect(result.providerIds).toEqual(['fetch', 'jina'])
    expect(result.results.map(({ title }) => title)).toEqual(['First', 'Second'])
  })

  it('propagates caller cancellation immediately without starting fallback', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    const abortController = new AbortController()
    const nativeFetch = vi.fn(
      (_input: string, _config: WebSearchExecutionConfig, httpOptions?: RequestInit) =>
        new Promise<WebSearchResponse>((_resolve, reject) => {
          httpOptions?.signal?.addEventListener('abort', () => reject(httpOptions.signal?.reason), { once: true })
        })
    )
    createWebSearchProviderMock.mockReturnValue({ fetchUrls: nativeFetch })

    const request = webSearchService.fetchUrls(
      { urls: ['https://example.com/article'] },
      { signal: abortController.signal }
    )
    await vi.waitFor(() => expect(nativeFetch).toHaveBeenCalledOnce())
    abortController.abort(abortError)

    await expect(request).rejects.toBe(abortError)
    expect(createWebSearchProviderMock).toHaveBeenCalledTimes(1)
    expect(sanitizeRemoteUrlMock).not.toHaveBeenCalled()
  })

  it('keeps the native failure when the literal URL guard rejects a private address before Jina', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.fetch.allow_private_network', false)
    const primaryError = new Error('native failed')
    const nativeFetch = vi.fn().mockRejectedValue(primaryError)
    sanitizeRemoteUrlMock.mockImplementation(() => {
      throw new Error('Unsafe remote url')
    })
    createWebSearchProviderMock.mockReturnValue({ fetchUrls: nativeFetch })

    await expect(webSearchService.fetchUrls({ urls: ['http://127.0.0.1/article'] })).rejects.toBe(primaryError)

    expect(createWebSearchProviderMock).toHaveBeenCalledTimes(1)
    expect(sanitizeRemoteUrlMock).toHaveBeenCalledWith('http://127.0.0.1/article', undefined, false)
    expect(resolveRemoteFetchUrlMock).not.toHaveBeenCalled()
  })

  it('reaches the Jina fallback for a private address when app.fetch.allow_private_network is on', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.fetch.allow_private_network', true)
    const nativeFetch = vi.fn().mockRejectedValue(new Error('native failed'))
    const jinaFetch = vi
      .fn()
      .mockResolvedValue(
        response('jina', 'fetchUrls', 'http://192.168.1.10/wiki', [
          { title: 'NAS', content: 'Wiki content', url: 'http://192.168.1.10/wiki' }
        ])
      )
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'fetch' ? { fetchUrls: nativeFetch } : { fetchUrls: jinaFetch }
    )

    const result = await webSearchService.fetchUrlsUnprocessed({ urls: ['http://192.168.1.10/wiki'] })

    expect(sanitizeRemoteUrlMock).toHaveBeenCalledWith('http://192.168.1.10/wiki', undefined, true)
    expect(jinaFetch).toHaveBeenCalledWith('http://192.168.1.10/wiki', expect.any(Object), undefined)
    expect(result.results[0]?.title).toBe('NAS')
  })

  it('retains primary and fallback diagnostics when both fetch providers fail', async () => {
    const primaryError = new Error('native failed')
    const fallbackError = new Error('Jina failed')
    const nativeFetch = vi.fn().mockRejectedValue(primaryError)
    const jinaFetch = vi.fn().mockRejectedValue(fallbackError)
    createWebSearchProviderMock.mockImplementation((provider: WebSearchProvider) =>
      provider.id === 'fetch' ? { fetchUrls: nativeFetch } : { fetchUrls: jinaFetch }
    )

    await expect(webSearchService.fetchUrls({ urls: ['https://example.com/article'] })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AggregateError &&
        error.cause === primaryError &&
        error.errors.includes(primaryError) &&
        error.errors.includes(fallbackError)
    )
  })

  it('logs and throws when a default provider is not configured', async () => {
    setWebSearchPreferences({ defaultSearchKeywordsProvider: null })

    await expect(webSearchService.searchKeywords({ keywords: ['hello'] })).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'provider_not_configured',
      message: 'Default web search provider is not configured for capability searchKeywords'
    })

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Web search failed',
      expect.objectContaining({
        message: 'Default web search provider is not configured for capability searchKeywords'
      }),
      {
        providerId: undefined,
        capability: 'searchKeywords'
      }
    )
  })

  it('logs and throws when a provider does not implement the requested capability', async () => {
    await expect(webSearchService.searchKeywords({ providerId: 'fetch', keywords: ['hello'] })).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'capability_unsupported',
      message: 'Web search provider fetch does not support capability searchKeywords'
    })

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Web search failed',
      expect.objectContaining({
        message: 'Web search provider fetch does not support capability searchKeywords'
      }),
      {
        providerId: 'fetch',
        capability: 'searchKeywords'
      }
    )
  })

  it('logs and throws when provider metadata supports a missing driver capability', async () => {
    createWebSearchProviderMock.mockReturnValue({})

    await expect(webSearchService.searchKeywords({ providerId: 'tavily', keywords: ['hello'] })).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'capability_unsupported',
      message: 'Web search provider tavily does not implement capability searchKeywords'
    })

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Web search failed',
      expect.objectContaining({
        message: 'Web search provider tavily does not implement capability searchKeywords'
      }),
      {
        providerId: 'tavily',
        capability: 'searchKeywords'
      }
    )
  })
})
