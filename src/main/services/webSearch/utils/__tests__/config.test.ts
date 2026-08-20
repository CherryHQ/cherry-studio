import { providerService } from '@main/data/services/ProviderService'
import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getProviderById, getProviderForCapability, getResolvedConfig, getRuntimeConfig } from '../config'

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getApiKeys: vi.fn(() => [] as ApiKeyEntry[])
  }
}))

const getLlmProviderApiKeys = vi.mocked(providerService.getApiKeys)

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
  beforeEach(() => {
    getLlmProviderApiKeys.mockReset()
    getLlmProviderApiKeys.mockReturnValue([])
  })

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

  it('throws a clear error for unknown provider ids', async () => {
    await expect(getProviderById('unknown' as any, mockPreferenceReader)).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'provider_unknown',
      message: 'Unknown web search provider: unknown'
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

  it('shares the exa provider api keys with exa-mcp when exa-mcp has no keys', async () => {
    const provider = await getProviderById('exa-mcp', {
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.provider_overrides') {
          return {
            exa: { apiKeys: ['shared-exa-key'] }
          } as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    expect(provider.id).toBe('exa-mcp')
    expect(provider.apiKeys).toEqual(['shared-exa-key'])
  })

  it('keeps exa-mcp own api keys over shared exa keys', async () => {
    const provider = await getProviderById('exa-mcp', {
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.provider_overrides') {
          return {
            exa: { apiKeys: ['shared-exa-key'] },
            'exa-mcp': { apiKeys: ['own-mcp-key'] }
          } as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    expect(provider.apiKeys).toEqual(['own-mcp-key'])
  })

  it('does not inherit exa keys when exa has no keys configured', async () => {
    const provider = await getProviderById('exa-mcp', mockPreferenceReader)

    expect(provider.id).toBe('exa-mcp')
    expect(provider.apiKeys).toEqual([])
  })

  it('shares exa api keys to exa-mcp in the resolved provider list', async () => {
    const resolved = await getResolvedConfig({
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.provider_overrides') {
          return {
            exa: { apiKeys: ['shared-exa-key'] }
          } as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    const exaMcp = resolved.providers.find((provider) => provider.id === 'exa-mcp')
    expect(exaMcp?.apiKeys).toEqual(['shared-exa-key'])
  })

  it('authenticates zhipu web search with the zhipu model provider key', async () => {
    // The web search settings page has no key input for zhipu; it sends users to model
    // provider settings, so the key only ever exists on the model provider.
    getLlmProviderApiKeys.mockReturnValue([{ id: 'entry-1', key: 'zhipu-llm-key', isEnabled: true }])

    const provider = await getProviderById('zhipu', mockPreferenceReader)

    expect(getLlmProviderApiKeys).toHaveBeenCalledWith('zhipu', { enabled: true })
    expect(provider.apiKeys).toEqual(['zhipu-llm-key'])
  })

  it('ignores stale web search keys when no zhipu model provider row exists', async () => {
    getLlmProviderApiKeys.mockImplementation(() => {
      throw new Error('Provider not found: zhipu')
    })

    const provider = await getProviderById('zhipu', {
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.provider_overrides') {
          return { zhipu: { apiKeys: ['stale-websearch-key'] } } as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    expect(provider).toMatchObject({
      id: 'zhipu',
      apiKeys: []
    })
  })

  it('ignores a stale web search key when the zhipu model provider key changes', async () => {
    getLlmProviderApiKeys.mockReturnValue([{ id: 'entry-1', key: 'zhipu-llm-key', isEnabled: true }])

    const provider = await getProviderById('zhipu', {
      async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
        if (key === 'chat.web_search.provider_overrides') {
          return { zhipu: { apiKeys: ['zhipu-websearch-key'] } } as PreferenceDefaultScopeType[K]
        }

        return preferenceValues[key] as PreferenceDefaultScopeType[K]
      }
    })

    expect(provider.apiKeys).toEqual(['zhipu-llm-key'])
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
    ).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'provider_not_configured',
      message: 'Default web search provider is not configured for capability searchKeywords'
    })
  })

  it('throws when a configured default provider does not support the requested capability', async () => {
    await expect(
      getProviderForCapability(undefined, 'fetchUrls', {
        async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
          if (key === 'chat.web_search.default_fetch_urls_provider') {
            return 'tavily' as PreferenceDefaultScopeType[K]
          }

          return preferenceValues[key] as PreferenceDefaultScopeType[K]
        }
      })
    ).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'capability_unsupported',
      message: 'Web search provider tavily does not support capability fetchUrls'
    })
  })

  it('throws when an explicit provider does not support the requested capability', async () => {
    await expect(getProviderForCapability('fetch', 'searchKeywords', mockPreferenceReader)).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'capability_unsupported',
      message: 'Web search provider fetch does not support capability searchKeywords'
    })
  })

  it('throws a clear error when an explicit provider id is unknown', async () => {
    await expect(
      getProviderForCapability('unknown' as any, 'searchKeywords', mockPreferenceReader)
    ).rejects.toMatchObject({
      name: 'WebSearchConfigError',
      code: 'provider_unknown',
      message: 'Unknown web search provider: unknown'
    })
  })
})
