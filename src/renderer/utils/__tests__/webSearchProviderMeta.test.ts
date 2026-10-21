import { describe, expect, it } from 'vitest'

import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/webSearchProviders'

import {
  createWebSearchMenuEntry,
  getWebSearchCapabilityTitleKey,
  getWebSearchFeatureSections,
  getWebSearchProviderApiKeyWebsite,
  getWebSearchProviderDescriptionKey,
  getWebSearchProviderIconRef,
  getWebSearchProviderOfficialWebsite
} from '../webSearchProviderMeta'

const providers: WebSearchProvider[] = [
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
  it('shows Yuanbao metadata in keyword search without offering URL fetching', () => {
    expect(getWebSearchProviderDescriptionKey('yuanbao')).toBe('settings.tool.websearch.provider_description.yuanbao')
    expect(getWebSearchProviderIconRef('yuanbao')).toMatchObject({ kind: 'provider', key: 'yuanbao' })
    expect(getWebSearchProviderOfficialWebsite('yuanbao')).toBe('https://cloud.tencent.com/product/wsa')
    expect(getWebSearchProviderApiKeyWebsite('yuanbao')).toBe('https://console.cloud.tencent.com/wsa')
    const sections = getWebSearchFeatureSections(
      PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => ({
        ...preset,
        capabilities: [...preset.capabilities],
        apiKeys: [],
        engines: [],
        basicAuthUsername: '',
        basicAuthPassword: ''
      }))
    )
    expect(
      sections.find((section) => section.capability === 'searchKeywords')?.entries.map((entry) => entry.provider.id)
    ).toContain('yuanbao')
    expect(
      sections.find((section) => section.capability === 'fetchUrls')?.entries.map((entry) => entry.provider.id)
    ).not.toContain('yuanbao')
  })

  it('returns provider display metadata', () => {
    expect(getWebSearchProviderDescriptionKey('exa-mcp')).toBe('settings.tool.websearch.provider_description.exa_mcp')
    expect(getWebSearchProviderIconRef('fetch')).toMatchObject({ kind: 'provider', key: 'cherryin' })
    expect(getWebSearchProviderOfficialWebsite('jina')).toBe('https://jina.ai/reader')
    expect(getWebSearchProviderApiKeyWebsite('jina')).toBe('https://jina.ai')
    expect(getWebSearchProviderIconRef('parallel')).toMatchObject({ kind: 'provider', key: 'parallel' })
    expect(getWebSearchProviderOfficialWebsite('parallel')).toBe('https://parallel.ai')
    expect(getWebSearchProviderApiKeyWebsite('parallel')).toBe('https://platform.parallel.ai')
    expect(getWebSearchProviderIconRef('serply')).toMatchObject({ kind: 'provider', key: 'serply' })
    expect(getWebSearchProviderOfficialWebsite('serply')).toBe('https://serply.io')
    expect(getWebSearchProviderApiKeyWebsite('serply')).toBe('https://serply.io')
    expect(getWebSearchProviderApiKeyWebsite('fetch')).toBeUndefined()
  })

  it('returns capability title keys', () => {
    expect(getWebSearchCapabilityTitleKey('searchKeywords')).toBe('settings.tool.websearch.search_provider')
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
  })
})
