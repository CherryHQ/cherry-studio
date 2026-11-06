import { describe, expect, it } from 'vitest'

import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { WEB_SEARCH_PROVIDER_IDS } from '@shared/data/preference/preferenceTypes'

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
    expect(getWebSearchProviderIconRef('desearch')).toMatchObject({ kind: 'provider', key: 'desearch' })
    expect(getWebSearchProviderOfficialWebsite('desearch')).toBe('https://desearch.ai')
    expect(getWebSearchProviderApiKeyWebsite('desearch')).toBe('https://console.desearch.ai/api-keys')
    expect(getWebSearchProviderApiKeyWebsite('fetch')).toBeUndefined()
  })

  it('links Yuanbao API key onboarding to Tencent key management', () => {
    expect(getWebSearchProviderApiKeyWebsite('yuanbao')).toBe(
      'https://console.cloud.tencent.com/wsapi/index?tab=apikey'
    )
  })

  it('does not reference the retired Tencent WSA console path in provider websites', () => {
    for (const id of WEB_SEARCH_PROVIDER_IDS) {
      for (const [field, website] of [
        ['apiKeyWebsite', getWebSearchProviderApiKeyWebsite(id)],
        ['officialWebsite', getWebSearchProviderOfficialWebsite(id)]
      ] as const) {
        if (website === undefined) continue

        const url = new URL(website)

        expect(
          url.hostname === 'console.cloud.tencent.com' && (url.pathname === '/wsa' || url.pathname.startsWith('/wsa/')),
          `${id}.${field}: ${website}`
        ).toBe(false)
      }
    }
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
