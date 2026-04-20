import type { WebSearchProvider } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import {
  filterSupportedWebSearchProviders,
  isSupportedWebSearchProviderId,
  SUPPORTED_WEB_SEARCH_PROVIDER_IDS,
  WEB_SEARCH_PROVIDERS,
  webSearchProviderRequiresApiKey,
  webSearchProviderSupportsBasicAuth
} from '../webSearchProviders'

describe('webSearchProviders config', () => {
  it('keeps the supported provider list aligned with presets', () => {
    expect(SUPPORTED_WEB_SEARCH_PROVIDER_IDS).toEqual(WEB_SEARCH_PROVIDERS.map((provider) => provider.id))
    expect(SUPPORTED_WEB_SEARCH_PROVIDER_IDS).not.toContain('local-google')
    expect(SUPPORTED_WEB_SEARCH_PROVIDER_IDS).not.toContain('local-bing')
    expect(SUPPORTED_WEB_SEARCH_PROVIDER_IDS).not.toContain('local-baidu')
  })

  it('recognizes only supported provider ids', () => {
    expect(isSupportedWebSearchProviderId('tavily')).toBe(true)
    expect(isSupportedWebSearchProviderId('local-google')).toBe(false)
    expect(isSupportedWebSearchProviderId('local-bing')).toBe(false)
    expect(isSupportedWebSearchProviderId('local-baidu')).toBe(false)
    expect(isSupportedWebSearchProviderId(undefined)).toBe(false)
  })

  it('filters unsupported providers out of renderer-facing lists', () => {
    const providers = [
      { id: 'tavily', name: 'Tavily', apiHost: 'https://api.tavily.com', apiKey: '' },
      { id: 'local-bing', name: 'Bing', url: 'https://bing.test?q=%s' },
      { id: 'local-google', name: 'Google', url: 'https://google.test?q=%s' }
    ] as WebSearchProvider[]

    expect(filterSupportedWebSearchProviders(providers)).toEqual([
      { id: 'tavily', name: 'Tavily', apiHost: 'https://api.tavily.com', apiKey: '' }
    ])
  })

  it('exposes provider capabilities explicitly', () => {
    expect(webSearchProviderRequiresApiKey('tavily')).toBe(true)
    expect(webSearchProviderRequiresApiKey('searxng')).toBe(false)
    expect(webSearchProviderRequiresApiKey('exa-mcp')).toBe(false)

    expect(webSearchProviderSupportsBasicAuth('searxng')).toBe(true)
    expect(webSearchProviderSupportsBasicAuth('tavily')).toBe(false)
  })
})
