import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import {
  createWebSearchMenuEntry,
  getWebSearchCapabilityTitleKey,
  getWebSearchFeatureSections,
  getWebSearchProviderApiKeyWebsite,
  getWebSearchProviderDescriptionKey,
  getWebSearchProviderLogo,
  getWebSearchProviderOfficialWebsite
} from '../utils/webSearchProviderMeta'

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
  it('returns provider display metadata', () => {
    expect(getWebSearchProviderDescriptionKey('exa-mcp')).toBe('settings.tool.websearch.provider_description.exa_mcp')
    expect(getWebSearchProviderLogo('fetch')).toBeTruthy()
    expect(getWebSearchProviderOfficialWebsite('jina')).toBe('https://jina.ai/reader')
    expect(getWebSearchProviderApiKeyWebsite('jina')).toBe('https://jina.ai')
    expect(getWebSearchProviderApiKeyWebsite('fetch')).toBeUndefined()
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
  })
})
