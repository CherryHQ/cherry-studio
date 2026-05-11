import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import { getProviderById, getProviderForCapability, getResolvedConfig, getRuntimeConfig } from '../config'

const preferenceValues: Record<string, unknown> = {
  'chat.web_search.max_results': 5,
  'chat.web_search.exclude_domains': ['example.com'],
  'chat.web_search.compression.method': 'none',
  'chat.web_search.compression.cutoff_limit': null,
  'chat.web_search.default_search_keywords_provider': 'tavily',
  'chat.web_search.default_fetch_urls_provider': 'fetch',
  'chat.web_search.provider_overrides': {
    tavily: {
      apiKeys: ['tavily-key'],
      capabilities: {
        searchKeywords: {
          apiHost: ' https://custom.tavily.dev '
        }
      }
    }
  }
}

const mockPreferenceReader = {
  async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
    return preferenceValues[key] as PreferenceDefaultScopeType[K]
  }
}

describe('webSearch config utils', () => {
  it('resolves all supported provider types from layered presets + overrides by default', async () => {
    const resolved = await getResolvedConfig(mockPreferenceReader)
    const providerIds = resolved.providers.map((provider) => provider.id)

    expect(providerIds).toContain('exa-mcp')
    expect(providerIds).toContain('querit')
    expect(providerIds).toContain('fetch')
    expect(providerIds).toContain('jina')
    expect(providerIds).not.toContain('jina-reader')

    const tavily = resolved.providers.find((provider) => provider.id === 'tavily')
    expect(tavily?.apiKeys).toEqual(['tavily-key'])
  })

  it('returns runtime config from flattened preference keys', async () => {
    const runtime = await getRuntimeConfig(mockPreferenceReader)

    expect(runtime.maxResults).toBe(5)
    expect(runtime.excludeDomains).toEqual(['example.com'])
    expect(runtime.compression.method).toBe('none')
    expect(runtime.compression.cutoffLimit).toBe(2000)
  })

  it('defaults stale empty cutoff limit in runtime config', async () => {
    const runtime = await getRuntimeConfig({
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.compression.cutoff_limit') {
          return null as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    expect(runtime.compression.cutoffLimit).toBe(2000)
  })

  it('normalizes maxResults to at least 1 in runtime config', async () => {
    const runtime = await getRuntimeConfig({
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.max_results') {
          return 0 as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    expect(runtime.maxResults).toBe(1)
  })

  it('resolves a provider directly by id from the preset-backed config', async () => {
    const provider = await getProviderById('tavily', mockPreferenceReader)

    expect(provider).toMatchObject({
      id: 'tavily',
      name: 'Tavily',
      type: 'api',
      apiKeys: ['tavily-key'],
      capabilities: [
        {
          feature: 'searchKeywords',
          apiHost: 'https://custom.tavily.dev'
        }
      ]
    })
  })

  it('trims basic auth password whitespace when resolving providers', async () => {
    const provider = await getProviderById('searxng', {
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.provider_overrides') {
          return {
            searxng: {
              basicAuthPassword: ' pass '
            }
          } as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    expect(provider.basicAuthPassword).toBe('pass')
  })

  it('resolves URL fetch provider presets', async () => {
    const fetchProvider = await getProviderById('fetch', mockPreferenceReader)
    const jinaProvider = await getProviderById('jina', mockPreferenceReader)

    expect(fetchProvider).toMatchObject({
      id: 'fetch',
      name: 'fetch',
      type: 'api',
      apiKeys: [],
      capabilities: [
        {
          feature: 'fetchUrls'
        }
      ]
    })
    expect(jinaProvider).toMatchObject({
      id: 'jina',
      name: 'Jina',
      type: 'api',
      capabilities: [
        {
          feature: 'searchKeywords',
          apiHost: 'https://s.jina.ai'
        },
        {
          feature: 'fetchUrls',
          apiHost: 'https://r.jina.ai'
        }
      ]
    })
  })

  it('resolves default providers by capability', async () => {
    await expect(getProviderForCapability(undefined, 'searchKeywords', mockPreferenceReader)).resolves.toMatchObject({
      id: 'tavily'
    })
    await expect(getProviderForCapability(undefined, 'fetchUrls', mockPreferenceReader)).resolves.toMatchObject({
      id: 'fetch'
    })
  })

  it('throws when a capability default provider is not configured', async () => {
    await expect(
      getProviderForCapability(undefined, 'searchKeywords', {
        async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
          if (key === 'chat.web_search.default_search_keywords_provider') {
            return null as PreferenceDefaultScopeType[K]
          }

          return preferenceValues[key] as PreferenceDefaultScopeType[K]
        }
      })
    ).rejects.toThrow('Default web search provider is not configured for capability searchKeywords')
  })
})
