import { describe, expect, it } from 'vitest'

import { PRESETS_WEB_SEARCH_PROVIDERS } from '../../presets/web-search-providers'
import { findWebSearchCapability, mergeWebSearchProviderPresets } from '../webSearchProviderMerger'

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
})
