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
        apiKeys: [],
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
      'chat.web_search.default_provider': 'tavily',
      'chat.web_search.exclude_domains': ['example.com'],
      'chat.web_search.max_results': 12,
      'chat.web_search.provider_overrides': {
        tavily: {
          apiKeys: ['key-1']
        }
      },
      'chat.web_search.subscribe_sources': [
        {
          key: 1,
          url: 'https://example.com/list.txt',
          name: 'Example',
          blacklist: ['blocked.com']
        }
      ],
      'chat.web_search.compression.method': 'cutoff',
      'chat.web_search.compression.cutoff_limit': 2000,
      'chat.web_search.compression.cutoff_unit': 'token',
      'chat.web_search.compression.rag_document_count': 3,
      'chat.web_search.compression.rag_embedding_model_id': null,
      'chat.web_search.compression.rag_embedding_dimensions': null,
      'chat.web_search.compression.rag_rerank_model_id': null
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
        cutoffUnit: 'token',
        documentCount: 3
      })
    )
  })
})
