import type {
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import {
  buildRendererWebSearchState,
  buildWebSearchProviderOverrides,
  getWebSearchProviderAvailability,
  resolveWebSearchProviders,
  updateWebSearchProviderOverride,
  type WebSearchConfigAvailability
} from '../webSearchProviders'

type AvailabilityCase = {
  name: string
  overrides: WebSearchProviderOverrides
  providerId: WebSearchProviderId
  capability?: WebSearchCapability
  expected: WebSearchConfigAvailability
}

describe('webSearchProviders', () => {
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
    const providers = resolveWebSearchProviders({})
    const tavily = providers.find((provider) => provider.id === 'tavily')!
    const overrides = buildWebSearchProviderOverrides([
      {
        ...tavily,
        apiKey: 'key-1, key-2',
        capabilities: [{ feature: 'searchKeywords', apiHost: ' https://custom.tavily.dev ' }],
        engines: ['web'],
        basicAuthUsername: ' user ',
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
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://custom.tavily.dev' }]
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

  it('keeps explicit empty auth fields when building provider overrides', () => {
    const providers = resolveWebSearchProviders({})
    const tavily = providers.find((provider) => provider.id === 'tavily')!
    const overrides = buildWebSearchProviderOverrides([
      {
        ...tavily,
        apiKey: '',
        capabilities: [],
        engines: undefined,
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

  it('keeps provider key when a capability host is explicitly cleared to empty', () => {
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
        capabilities: [{ feature: 'searchKeywords', apiHost: ' ' }]
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
      defaultSearchKeywordsProvider: 'bocha',
      defaultFetchUrlsProvider: 'fetch',
      excludeDomains: ['example.com'],
      maxResults: 12,
      providerOverrides: {
        tavily: {
          apiKeys: ['key-1']
        }
      },
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

    expect(state.defaultSearchKeywordsProvider).toBe('bocha')
    expect(state.defaultFetchUrlsProvider).toBe('fetch')
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
      defaultSearchKeywordsProvider: null,
      defaultFetchUrlsProvider: 'fetch',
      excludeDomains: [],
      maxResults: 10,
      providerOverrides: {},
      subscribeSources: [],
      compressionMethod: 'cutoff',
      cutoffLimit: null as any,
      cutoffUnit: 'char'
    })

    expect(state.compressionConfig.cutoffLimit).toBe(2000)
  })

  const availabilityCases: AvailabilityCase[] = [
    {
      name: 'requires an API key even when the preset has a host',
      overrides: {},
      providerId: 'tavily',
      expected: { available: false, reason: 'apiKey' }
    },
    {
      name: 'rejects blank API keys for API-key providers',
      overrides: { tavily: { apiKeys: ['   '] } },
      providerId: 'tavily',
      expected: { available: false, reason: 'apiKey' }
    },
    {
      name: 'enables API-key providers with a configured key',
      overrides: { tavily: { apiKeys: ['tavily-key'] } },
      providerId: 'tavily',
      expected: { available: true }
    },
    {
      name: 'requires a host for non-API-key providers without preset hosts',
      overrides: {},
      providerId: 'searxng',
      expected: { available: false, reason: 'apiHost' }
    },
    {
      name: 'enables non-API-key providers with a configured host',
      overrides: { searxng: { capabilities: { searchKeywords: { apiHost: 'https://search.example.com' } } } },
      providerId: 'searxng',
      expected: { available: true }
    },
    {
      name: 'enables non-API-key providers that have a preset host',
      overrides: {},
      providerId: 'exa-mcp',
      expected: { available: true }
    },
    {
      name: 'enables the hostless built-in fetch provider for URL fetching',
      overrides: {},
      providerId: 'fetch',
      capability: 'fetchUrls',
      expected: { available: true }
    }
  ]

  it.each(availabilityCases)(
    'checks provider config availability: $name',
    ({ overrides, providerId, capability, expected }) => {
      const providers = resolveWebSearchProviders(overrides)
      const provider = providers.find((item) => item.id === providerId)!

      expect(getWebSearchProviderAvailability(provider, capability)).toEqual(expected)
    }
  )
})
