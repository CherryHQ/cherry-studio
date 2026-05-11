import { describe, expect, it } from 'vitest'

import { updateWebSearchProviderOverride } from '../webSearchProviders'

describe('webSearchProviders', () => {
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
