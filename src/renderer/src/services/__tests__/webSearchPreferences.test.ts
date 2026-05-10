import { preferenceService } from '@data/PreferenceService'
import { webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import type { UnifiedPreferenceKeyType, UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import {
  buildWebSearchProviderOverrides,
  checkWebSearchAvailability,
  getProviderApiHost,
  parseApiKeys,
  resolveWebSearchProviders,
  stringifyApiKeys,
  updateWebSearchProviderOverride,
  WEB_SEARCH_PREFERENCE_KEYS
} from '@shared/data/utils/webSearchPreferences'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildRendererWebSearchState,
  getCachedRendererWebSearchState,
  updateWebSearchProviderPreferenceOverride
} from '../webSearchPreferences'

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
  })

  describe('parseApiKeys', () => {
    it('splits CSV input, trims each, and drops blanks', () => {
      expect(parseApiKeys(' k1 , k2,, k3 ')).toEqual(['k1', 'k2', 'k3'])
    })

    it('returns undefined for empty / whitespace-only / missing input', () => {
      expect(parseApiKeys()).toBeUndefined()
      expect(parseApiKeys('')).toBeUndefined()
      expect(parseApiKeys('  ,  , ')).toBeUndefined()
    })
  })

  describe('stringifyApiKeys', () => {
    it('joins with comma after trimming each entry', () => {
      expect(stringifyApiKeys([' k1 ', 'k2', '  '])).toBe('k1,k2')
    })

    it('returns empty string when missing or empty', () => {
      expect(stringifyApiKeys()).toBe('')
      expect(stringifyApiKeys([])).toBe('')
    })
  })

  describe('getProviderApiHost', () => {
    it('returns the apiHost of the matching capability', () => {
      const provider = {
        capabilities: [
          { feature: 'searchKeywords' as const, apiHost: 'https://search.example' },
          { feature: 'fetchUrls' as const, apiHost: 'https://fetch.example' }
        ]
      }
      expect(getProviderApiHost(provider, 'searchKeywords')).toBe('https://search.example')
      expect(getProviderApiHost(provider, 'fetchUrls')).toBe('https://fetch.example')
    })

    it('defaults to searchKeywords capability and returns undefined when missing', () => {
      const provider = { capabilities: [{ feature: 'fetchUrls' as const, apiHost: 'https://fetch.example' }] }
      expect(getProviderApiHost(provider)).toBeUndefined()
    })
  })

  it('resolves renderer providers from preference overrides', () => {
    const providers = resolveWebSearchProviders({
      tavily: {
        apiKeys: [' key-1 ', 'key-2'],
        capabilities: {
          searchKeywords: {
            apiHost: ' https://custom.tavily.dev '
          }
        },
        engines: ['web'],
        basicAuthUsername: ' user ',
        basicAuthPassword: 'pass'
      }
    })

    expect(providers.find((provider) => provider.id === 'tavily')).toEqual(
      expect.objectContaining({
        id: 'tavily',
        apiKeys: [' key-1 ', 'key-2'],
        capabilities: expect.arrayContaining([{ feature: 'searchKeywords', apiHost: 'https://custom.tavily.dev' }]),
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
        type: 'api',
        apiKeys: ['key-1', 'key-2'],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://custom.tavily.dev' }],
        engines: ['web'],
        basicAuthUsername: 'user',
        basicAuthPassword: 'pass'
      }
    ])

    expect(overrides.tavily).toEqual({
      apiKeys: ['key-1', 'key-2'],
      capabilities: {
        searchKeywords: {
          apiHost: 'https://custom.tavily.dev'
        }
      },
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
      }
    )

    expect(overrides.tavily).toEqual({
      apiKeys: ['key-2', 'key-3'],
      capabilities: {
        searchKeywords: {
          apiHost: 'https://custom.tavily.dev'
        }
      }
    })
  })

  it('updates provider overrides through PreferenceService while preserving other providers', async () => {
    await preferenceService.set('chat.web_search.provider_overrides', {
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        capabilities: {
          searchKeywords: {
            apiHost: 'https://custom.zhipu.dev'
          }
        }
      }
    })

    await updateWebSearchProviderPreferenceOverride('zhipu', { apiKey: 'zhipu-key' })

    await expect(preferenceService.get('chat.web_search.provider_overrides')).resolves.toEqual({
      tavily: {
        apiKeys: ['tavily-key']
      },
      zhipu: {
        apiKeys: ['zhipu-key'],
        capabilities: {
          searchKeywords: {
            apiHost: 'https://custom.zhipu.dev'
          }
        }
      }
    })
  })

  it('keeps explicit empty auth fields when building provider overrides', () => {
    const overrides = buildWebSearchProviderOverrides([
      {
        id: 'tavily',
        name: 'Tavily',
        type: 'api',
        apiKeys: [],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
        engines: [],
        basicAuthUsername: '',
        basicAuthPassword: ''
      }
    ])

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
          capabilities: {
            searchKeywords: {
              apiHost: 'https://custom.tavily.dev'
            }
          }
        }
      },
      'tavily',
      {
        apiHost: ' '
      }
    )

    expect(overrides).toEqual({
      tavily: {
        capabilities: {
          searchKeywords: {
            apiHost: ''
          }
        }
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
      overrides: { searxng: { capabilities: { searchKeywords: { apiHost: 'https://search.example.com' } } } },
      providerId: 'searxng',
      expected: true
    },
    {
      name: 'enables non-API-key providers that have a preset host',
      overrides: {},
      providerId: 'exa-mcp',
      expected: true
    }
  ] as const)('checkWebSearchAvailability $name', async ({ overrides, providerId, expected }) => {
    await seedWebSearchPreferences({ providerOverrides: overrides })
    const state = getCachedRendererWebSearchState()
    const provider = state!.providers.find((p) => p.id === providerId)!

    expect(checkWebSearchAvailability(provider, webSearchProviderRequiresApiKey)).toBe(expected)
  })
})
