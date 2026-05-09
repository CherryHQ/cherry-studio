import type {
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import {
  getWebSearchProviderAvailability,
  resolveWebSearchProviders,
  updateWebSearchProviderOverride
} from '../webSearchProviders'

type AvailabilityCase = {
  name: string
  overrides: WebSearchProviderOverrides
  providerId: WebSearchProviderId
  capability?: WebSearchCapability
  expected: ReturnType<typeof getWebSearchProviderAvailability>
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
        apiKeys: ['key-1', 'key-2'],
        capabilities: [{ feature: 'searchKeywords', apiHost: 'https://custom.tavily.dev' }],
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
