import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import {
  createWebSearchMenuEntry,
  flattenWebSearchFeatureSections,
  getUnavailableProviderDialogConfig,
  getWebSearchCapabilityTitleKey,
  getWebSearchFeatureSections,
  getWebSearchProviderAvatarColor,
  getWebSearchProviderDescriptionKey,
  resolveWebSearchEntryCapability
} from '../utils/webSearchProviderMeta'

const providers: ResolvedWebSearchProvider[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    apiKeys: [],
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'fetch',
    name: 'fetch',
    type: 'api',
    apiKeys: [],
    capabilities: [{ feature: 'fetchUrls' }],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  },
  {
    id: 'jina',
    name: 'Jina',
    type: 'api',
    apiKeys: [],
    capabilities: [
      { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
      { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
    ],
    engines: [],
    basicAuthUsername: '',
    basicAuthPassword: ''
  }
]

describe('webSearchProviderMeta', () => {
  it('returns provider display metadata', () => {
    expect(getWebSearchProviderAvatarColor('tavily')).toBe('#6366f1')
    expect(getWebSearchProviderDescriptionKey('exa-mcp')).toBe('settings.tool.websearch.provider_description.exa_mcp')
  })

  it('returns capability title keys', () => {
    expect(getWebSearchCapabilityTitleKey('searchKeywords')).toBe('settings.tool.websearch.default_provider')
    expect(getWebSearchCapabilityTitleKey('fetchUrls')).toBe('settings.tool.websearch.fetch_urls_provider')
  })

  it('creates menu entries for supported capabilities', () => {
    expect(createWebSearchMenuEntry(providers[0], 'searchKeywords')).toMatchObject({
      key: 'searchKeywords:tavily',
      capability: 'searchKeywords',
      provider: { id: 'tavily' },
      providerCapability: { feature: 'searchKeywords' }
    })
    expect(createWebSearchMenuEntry(providers[0], 'fetchUrls')).toBeNull()
  })

  it('groups provider menu entries by capability', () => {
    const sections = getWebSearchFeatureSections(providers)

    expect(sections).toHaveLength(2)
    expect(sections[0]).toMatchObject({
      capability: 'searchKeywords',
      entries: [{ key: 'searchKeywords:tavily' }, { key: 'searchKeywords:jina' }]
    })
    expect(sections[1]).toMatchObject({
      capability: 'fetchUrls',
      entries: [{ key: 'fetchUrls:fetch' }, { key: 'fetchUrls:jina' }]
    })
    expect(flattenWebSearchFeatureSections(sections).map((entry) => entry.key)).toEqual([
      'searchKeywords:tavily',
      'searchKeywords:jina',
      'fetchUrls:fetch',
      'fetchUrls:jina'
    ])
  })

  it('resolves requested capabilities with provider fallback', () => {
    expect(resolveWebSearchEntryCapability(providers[2], 'fetchUrls')).toBe('fetchUrls')
    expect(resolveWebSearchEntryCapability(providers[2], 'searchKeywords')).toBe('searchKeywords')
    expect(resolveWebSearchEntryCapability(providers[0], 'fetchUrls')).toBe('searchKeywords')
    expect(resolveWebSearchEntryCapability(providers[1], 'unknown')).toBe('fetchUrls')
  })

  it('builds unavailable provider dialog config', () => {
    const t = vi.fn((key: string) => key) as unknown as TFunction

    expect(
      getUnavailableProviderDialogConfig(
        {
          id: 'tavily',
          name: 'Tavily',
          type: 'api',
          apiKeys: [],
          capabilities: [],
          engines: [],
          basicAuthUsername: '',
          basicAuthPassword: ''
        },
        t,
        'apiKey'
      )
    ).toEqual({
      title: 'settings.tool.websearch.search_provider',
      content: 'Tavily settings.tool.websearch.apikey',
      okText: 'settings.tool.websearch.api_key_required.ok'
    })
  })
})
