import { describe, expect, it } from 'vitest'

import { PRESETS_WEB_SEARCH_PROVIDERS } from '../../presets/web-search-providers'
import {
  findWebSearchCapability,
  mergeWebSearchProviderPresets,
  updateWebSearchProviderOverride
} from '../webSearchProviderMerger'

describe('webSearchProviderMerger', () => {
  it('finds a provider capability by feature', () => {
    const jina = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'jina')

    expect(jina).toBeDefined()
    expect(findWebSearchCapability(jina!, 'searchKeywords')?.apiHost).toBe('https://s.jina.ai')
    expect(findWebSearchCapability(jina!, 'fetchUrls')?.apiHost).toBe('https://r.jina.ai')
  })

  it('resolves providers from presets and preference overrides', () => {
    const providers = mergeWebSearchProviderPresets({
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
        apiKeys: ['key-1', 'key-2'],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://custom.tavily.dev' }],
        engines: ['web'],
        basicAuthUsername: 'user',
        basicAuthPassword: 'pass'
      })
    )
  })

  it('resolves Searxng with a localhost default host', () => {
    const providers = mergeWebSearchProviderPresets({})

    expect(providers.find((provider) => provider.id === 'searxng')).toEqual(
      expect.objectContaining({
        capabilities: [{ feature: 'searchKeywords', apiHost: 'http://localhost:8080' }]
      })
    )
  })

  it('preserves basic auth password whitespace when resolving providers', () => {
    const providers = mergeWebSearchProviderPresets({
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

  it('ignores API host overrides for hostless providers', () => {
    const providers = mergeWebSearchProviderPresets({
      fetch: {
        capabilities: {
          fetchUrls: {
            apiHost: 'https://example.com'
          }
        }
      }
    })

    expect(providers.find((provider) => provider.id === 'fetch')).toEqual(
      expect.objectContaining({
        capabilities: [{ feature: 'fetchUrls' }]
      })
    )
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
        apiKeys: ['key-2', 'key-3'],
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

  it('keeps a capability host override when explicitly cleared away from preset default', () => {
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

  it('drops API host overrides for hostless built-in providers', () => {
    const overrides = updateWebSearchProviderOverride({}, 'fetch', {
      capabilities: [{ feature: 'fetchUrls', apiHost: 'https://example.com' }]
    })

    expect(overrides).toEqual({})
  })

  it('removes provider override when updates match preset defaults', () => {
    const overrides = updateWebSearchProviderOverride(
      {
        tavily: {
          apiKeys: ['key-1'],
          capabilities: {
            searchKeywords: {
              apiHost: 'https://custom.tavily.dev'
            }
          },
          engines: ['web'],
          basicAuthUsername: 'user',
          basicAuthPassword: 'pass'
        }
      },
      'tavily',
      {
        apiKeys: [],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
        engines: [],
        basicAuthUsername: '',
        basicAuthPassword: ''
      }
    )

    expect(overrides).toEqual({})
  })

  it('drops orphan basic auth password when username is cleared', () => {
    const overrides = updateWebSearchProviderOverride(
      {
        searxng: {
          capabilities: {
            searchKeywords: {
              apiHost: 'https://search.example.com'
            }
          },
          basicAuthUsername: 'user',
          basicAuthPassword: 'pass'
        }
      },
      'searxng',
      {
        basicAuthUsername: ''
      }
    )

    expect(overrides).toEqual({
      searxng: {
        capabilities: {
          searchKeywords: {
            apiHost: 'https://search.example.com'
          }
        }
      }
    })
  })
})
