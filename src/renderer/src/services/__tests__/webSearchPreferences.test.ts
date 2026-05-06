import { cacheService } from '@data/CacheService'
import { preferenceService } from '@data/PreferenceService'
import type { UnifiedPreferenceKeyType, UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const webSearchEngineProviderMock = vi.hoisted(() => ({
  search: vi.fn()
}))

vi.mock('@renderer/providers/WebSearchProvider', () => ({
  default: vi.fn().mockImplementation(() => ({
    search: webSearchEngineProviderMock.search
  }))
}))

import {
  buildRendererWebSearchState,
  buildWebSearchProviderOverrides,
  getCachedRendererWebSearchState,
  resolveWebSearchProviders,
  updateWebSearchProviderOverride,
  updateWebSearchProviderPreferenceOverride,
  WEB_SEARCH_PREFERENCE_KEYS,
  WebSearchService
} from '../WebSearchService'

const preferenceServiceMock = preferenceService as typeof preferenceService & {
  _resetMockState?: () => void
  _getMockState?: () => Partial<UnifiedPreferenceType>
}

type WebSearchPreferenceAlias = keyof typeof WEB_SEARCH_PREFERENCE_KEYS

async function seedWebSearchPreferences(overrides: Partial<Record<WebSearchPreferenceAlias, unknown>> = {}) {
  const overrideValues = Object.fromEntries(
    (Object.entries(overrides) as Array<[WebSearchPreferenceAlias, unknown]>).map(([alias, value]) => [
      WEB_SEARCH_PREFERENCE_KEYS[alias],
      value
    ])
  )

  await preferenceService.setMultiple({
    [WEB_SEARCH_PREFERENCE_KEYS.defaultProvider]: null,
    [WEB_SEARCH_PREFERENCE_KEYS.excludeDomains]: [],
    [WEB_SEARCH_PREFERENCE_KEYS.maxResults]: 5,
    [WEB_SEARCH_PREFERENCE_KEYS.providerOverrides]: {},
    [WEB_SEARCH_PREFERENCE_KEYS.searchWithTime]: true,
    [WEB_SEARCH_PREFERENCE_KEYS.subscribeSources]: [],
    [WEB_SEARCH_PREFERENCE_KEYS.compressionMethod]: 'none',
    [WEB_SEARCH_PREFERENCE_KEYS.cutoffLimit]: 2000,
    [WEB_SEARCH_PREFERENCE_KEYS.cutoffUnit]: 'char',
    ...overrideValues
  })
}

describe('webSearchPreferences', () => {
  beforeEach(() => {
    preferenceServiceMock._resetMockState?.()
    vi.mocked(preferenceService.isCached).mockImplementation((key: UnifiedPreferenceKeyType) => {
      const mockState = preferenceServiceMock._getMockState?.()
      return mockState ? key in mockState && mockState[key] !== undefined : false
    })
    vi.mocked(preferenceService.getCachedValue).mockImplementation(<K extends UnifiedPreferenceKeyType>(key: K) => {
      return preferenceServiceMock._getMockState?.()[key] as UnifiedPreferenceType[K] | undefined
    })
    MockCacheUtils.resetMocks()
    webSearchEngineProviderMock.search.mockReset()
    webSearchEngineProviderMock.search.mockResolvedValue({ results: [] })
  })

  it('resolves renderer providers from preference overrides', () => {
    const providers = resolveWebSearchProviders({
      tavily: {
        apiKeys: [' key-1 ', 'key-2'],
        apiHost: ' https://custom.tavily.dev ',
        engines: ['web'],
        basicAuthUsername: ' user ',
        basicAuthPassword: 'pass'
      }
    })

    expect(providers.find((provider) => provider.id === 'tavily')).toEqual(
      expect.objectContaining({
        id: 'tavily',
        apiKey: 'key-1,key-2',
        apiHost: 'https://custom.tavily.dev',
        engines: ['web'],
        basicAuthUsername: 'user',
        basicAuthPassword: 'pass'
      })
    )
  })

  it('preserves leading and trailing basic auth password spaces when resolving providers', () => {
    const providers = resolveWebSearchProviders({
      searxng: {
        basicAuthPassword: ' pass with spaces '
      }
    })

    expect(providers.find((provider) => provider.id === 'searxng')).toEqual(
      expect.objectContaining({
        basicAuthPassword: ' pass with spaces '
      })
    )
  })

  it('builds preference overrides from renderer providers', () => {
    const overrides = buildWebSearchProviderOverrides([
      {
        id: 'tavily',
        name: 'Tavily',
        apiKey: 'key-1, key-2',
        apiHost: ' https://custom.tavily.dev ',
        engines: ['web'],
        basicAuthUsername: ' user ',
        basicAuthPassword: 'pass'
      }
    ] as any)

    expect(overrides.tavily).toEqual({
      apiKeys: ['key-1', 'key-2'],
      apiHost: 'https://custom.tavily.dev',
      engines: ['web'],
      basicAuthUsername: 'user',
      basicAuthPassword: 'pass'
    })
  })

  it('updates a single provider override without store state', () => {
    const overrides = updateWebSearchProviderOverride(
      {
        tavily: {
          apiKeys: ['key-1']
        }
      },
      'tavily',
      {
        apiKey: 'key-2, key-3',
        apiHost: 'https://custom.tavily.dev'
      } as any
    )

    expect(overrides.tavily).toEqual({
      apiKeys: ['key-2', 'key-3'],
      apiHost: 'https://custom.tavily.dev'
    })
  })

  it('updates provider overrides through PreferenceService while preserving other providers', async () => {
    await preferenceService.set('chat.web_search.provider_overrides', {
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        apiHost: 'https://custom.zhipu.dev'
      }
    })

    await updateWebSearchProviderPreferenceOverride('zhipu', { apiKey: 'zhipu-key' })

    await expect(preferenceService.get('chat.web_search.provider_overrides')).resolves.toEqual({
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        apiKeys: ['zhipu-key'],
        apiHost: 'https://custom.zhipu.dev'
      }
    })
  })

  it('keeps explicit empty auth fields when building provider overrides', () => {
    const overrides = buildWebSearchProviderOverrides([
      {
        id: 'tavily',
        name: 'Tavily',
        apiKey: '',
        apiHost: undefined,
        engines: undefined,
        basicAuthUsername: '',
        basicAuthPassword: ''
      }
    ] as any)

    expect(overrides).toEqual({
      tavily: {
        basicAuthUsername: '',
        basicAuthPassword: ''
      }
    })
  })

  it('keeps provider key when a field is explicitly cleared to empty', () => {
    const overrides = updateWebSearchProviderOverride(
      {
        tavily: {
          apiHost: 'https://custom.tavily.dev'
        }
      },
      'tavily',
      {
        apiHost: ' '
      } as any
    )

    expect(overrides).toEqual({
      tavily: {
        apiHost: ''
      }
    })
  })

  it('builds renderer websearch state from preference snapshot', () => {
    const state = buildRendererWebSearchState({
      defaultProvider: 'bocha',
      excludeDomains: ['example.com'],
      maxResults: 12,
      providerOverrides: {
        tavily: {
          apiKeys: ['key-1']
        }
      },
      searchWithTime: true,
      subscribeSources: [
        {
          key: 1,
          url: 'https://example.com/list.txt',
          name: 'Example',
          blacklist: ['blocked.com']
        }
      ],
      compressionMethod: 'cutoff',
      cutoffLimit: 2000,
      cutoffUnit: 'token'
    })

    expect(state.defaultProvider).toBe('bocha')
    expect(state.searchWithTime).toBe(true)
    expect(state.maxResults).toBe(12)
    expect(state.excludeDomains).toEqual(['example.com'])
    expect(state.subscribeSources).toHaveLength(1)
    expect(state.compressionConfig).toEqual(
      expect.objectContaining({
        method: 'cutoff',
        cutoffLimit: 2000,
        cutoffUnit: 'token'
      })
    )
  })

  it('defaults stale empty cutoff limit when building renderer state', () => {
    const state = buildRendererWebSearchState({
      defaultProvider: null,
      excludeDomains: [],
      maxResults: 10,
      providerOverrides: {},
      searchWithTime: true,
      subscribeSources: [],
      compressionMethod: 'cutoff',
      cutoffLimit: null as any,
      cutoffUnit: 'char'
    })

    expect(state.compressionConfig.cutoffLimit).toBe(2000)
  })

  it('uses the searchWithTime preference regardless of selected provider', () => {
    const state = buildRendererWebSearchState({
      defaultProvider: 'tavily',
      excludeDomains: [],
      maxResults: 5,
      providerOverrides: {},
      searchWithTime: false,
      subscribeSources: [],
      compressionMethod: 'none',
      cutoffLimit: 2000,
      cutoffUnit: 'char'
    })

    expect(state.searchWithTime).toBe(false)
  })

  it('returns null for sync renderer state while the preference cache is cold', () => {
    vi.mocked(preferenceService.isCached).mockReturnValue(false)
    vi.mocked(preferenceService.getCachedValue).mockReturnValue(undefined)

    expect(getCachedRendererWebSearchState()).toBeNull()
  })

  it('reports unknown provider availability while provider overrides cache is cold', () => {
    vi.mocked(preferenceService.isCached).mockReturnValue(false)
    vi.mocked(preferenceService.getCachedValue).mockReturnValue(undefined)

    const service = new WebSearchService()

    expect(service.isWebSearchEnabled('tavily')).toBe('unknown')
  })

  it.each([
    {
      name: 'requires an API key even when the preset has a host',
      overrides: {},
      providerId: 'tavily',
      expected: false
    },
    {
      name: 'rejects blank API keys for API-key providers',
      overrides: { tavily: { apiKeys: ['   '] } },
      providerId: 'tavily',
      expected: false
    },
    {
      name: 'enables API-key providers with a configured key',
      overrides: { tavily: { apiKeys: ['tavily-key'] } },
      providerId: 'tavily',
      expected: true
    },
    {
      name: 'requires a host for non-API-key providers without preset hosts',
      overrides: {},
      providerId: 'searxng',
      expected: false
    },
    {
      name: 'enables non-API-key providers with a configured host',
      overrides: { searxng: { apiHost: 'https://search.example.com' } },
      providerId: 'searxng',
      expected: true
    },
    {
      name: 'enables non-API-key providers that have a preset host',
      overrides: {},
      providerId: 'exa-mcp',
      expected: true
    }
  ] as const)('isWebSearchEnabled $name', async ({ overrides, providerId, expected }) => {
    await seedWebSearchPreferences({ providerOverrides: overrides })

    const service = new WebSearchService()

    expect(service.isWebSearchEnabled(providerId)).toBe(expected)
  })

  it('keeps successful renderer web-search results when a non-abort query fails', async () => {
    await seedWebSearchPreferences({ searchWithTime: false })
    webSearchEngineProviderMock.search.mockImplementation(async (query: string) => {
      if (query === 'bad') {
        throw new Error('search failed')
      }

      return {
        query,
        results: [
          {
            title: query,
            content: `content for ${query}`,
            url: `https://example.com/${query}`
          }
        ]
      }
    })

    vi.useFakeTimers()
    const service = new WebSearchService()
    const resultPromise = service.processWebsearch(
      { id: 'tavily', name: 'Tavily', apiKey: 'key', apiHost: 'https://api.tavily.com' },
      { websearch: { question: ['good', 'bad', 'better'] } },
      'request-partial'
    )

    await vi.runAllTimersAsync()
    const result = await resultPromise
    vi.useRealTimers()

    expect(result).toEqual({
      query: 'good | bad | better',
      results: [
        {
          title: 'good',
          content: 'content for good',
          url: 'https://example.com/good'
        },
        {
          title: 'better',
          content: 'content for better',
          url: 'https://example.com/better'
        }
      ]
    })
    expect(cacheService.setShared).toHaveBeenCalledWith(
      'chat.web_search.active_searches',
      expect.objectContaining({
        'request-partial': {
          phase: 'partial_failure',
          countAfter: 2
        }
      })
    )
  })

  it('still throws renderer web-search abort failures', async () => {
    await seedWebSearchPreferences({ searchWithTime: false })
    const abortError = new DOMException('Request was aborted.', 'AbortError')
    webSearchEngineProviderMock.search.mockRejectedValue(abortError)

    const service = new WebSearchService()

    await expect(
      service.processWebsearch(
        { id: 'tavily', name: 'Tavily', apiKey: 'key', apiHost: 'https://api.tavily.com' },
        { websearch: { question: ['abort me'] } },
        'request-abort'
      )
    ).rejects.toBe(abortError)
  })

  it('uses async preferences for search when the renderer cache is cold', async () => {
    await seedWebSearchPreferences({ searchWithTime: false })
    vi.mocked(preferenceService.isCached).mockReturnValue(false)
    vi.mocked(preferenceService.getCachedValue).mockReturnValue(undefined)

    const service = new WebSearchService()
    await service.search(
      { id: 'tavily', name: 'Tavily', apiKey: 'key', apiHost: 'https://api.tavily.com' },
      'latest news'
    )

    expect(webSearchEngineProviderMock.search).toHaveBeenCalledWith(
      'latest news',
      expect.objectContaining({ searchWithTime: false }),
      undefined
    )
  })

  it('adds current date context to search queries when searchWithTime is enabled', async () => {
    await seedWebSearchPreferences({ searchWithTime: true })

    const service = new WebSearchService()
    await service.search(
      { id: 'tavily', name: 'Tavily', apiKey: 'key', apiHost: 'https://api.tavily.com' },
      'latest news'
    )

    expect(webSearchEngineProviderMock.search).toHaveBeenCalledWith(
      expect.stringMatching(/^today is \d{4}-\d{2}-\d{2} \r\n latest news$/),
      expect.objectContaining({ searchWithTime: true }),
      undefined
    )
  })

  it('passes the original search query when searchWithTime is disabled', async () => {
    await seedWebSearchPreferences({ searchWithTime: false })

    const service = new WebSearchService()
    await service.search(
      { id: 'tavily', name: 'Tavily', apiKey: 'key', apiHost: 'https://api.tavily.com' },
      'latest news'
    )

    expect(webSearchEngineProviderMock.search).toHaveBeenCalledWith(
      'latest news',
      expect.objectContaining({ searchWithTime: false }),
      undefined
    )
  })
})
