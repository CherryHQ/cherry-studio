import { describe, expect, it } from 'vitest'

import {
  buildRendererWebSearchState,
  buildWebSearchProviderOverrides,
  resolveWebSearchProviders,
  updateWebSearchProviderOverride
} from '../WebSearchService'

describe('webSearchPreferences', () => {
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
      defaultProvider: 'tavily',
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

    expect(state.defaultProvider).toBe('tavily')
    expect(state.searchWithTime).toBe(false)
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
})
