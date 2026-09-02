import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/webSearchProviders'
import { describe, expect, it } from 'vitest'

import { isWebSearchProviderReady, resolveReadyWebSearchProvider } from '../webSearch'

describe('client web provider readiness', () => {
  const provider = (id: WebSearchProvider['id'], apiKeys: string[] = []): WebSearchProvider => {
    const preset = PRESETS_WEB_SEARCH_PROVIDERS.find((candidate) => candidate.id === id)!
    return {
      ...preset,
      apiKeys,
      capabilities: [...preset.capabilities],
      engines: [],
      basicAuthUsername: '',
      basicAuthPassword: ''
    }
  }

  it('accepts keyless and optional-key search providers with a valid host', () => {
    expect(isWebSearchProviderReady(provider('exa-mcp'), 'searchKeywords')).toBe(true)
    expect(isWebSearchProviderReady(provider('searxng'), 'searchKeywords')).toBe(true)
    expect(isWebSearchProviderReady(provider('firecrawl'), 'searchKeywords')).toBe(true)
  })

  it('requires an API key for providers that authenticate every search request', () => {
    expect(isWebSearchProviderReady(provider('tavily'), 'searchKeywords')).toBe(false)
    expect(isWebSearchProviderReady(provider('tavily', [' key ']), 'searchKeywords')).toBe(true)
  })

  it('supports both hostless and hosted URL-fetch capabilities without provider-id rules', () => {
    expect(isWebSearchProviderReady(provider('fetch'), 'fetchUrls')).toBe(true)
    expect(isWebSearchProviderReady(provider('jina'), 'fetchUrls')).toBe(true)
    expect(isWebSearchProviderReady(provider('firecrawl'), 'fetchUrls')).toBe(true)
    expect(isWebSearchProviderReady(provider('fetch'), 'searchKeywords')).toBe(false)
  })

  it('rejects invalid hosts when the capability metadata requires one', () => {
    const exaMcp = provider('exa-mcp')
    expect(
      isWebSearchProviderReady(
        {
          ...exaMcp,
          capabilities: [{ ...exaMcp.capabilities[0], apiHost: 'not-a-url' }]
        },
        'searchKeywords'
      )
    ).toBe(false)
  })

  it('keeps a ready primary provider instead of replacing it with the fallback', () => {
    const tavily = provider('tavily', ['key'])
    const exaMcp = provider('exa-mcp')

    expect(resolveReadyWebSearchProvider([tavily, exaMcp], tavily, 'searchKeywords')).toBe(tavily)
  })

  it('does not select a fallback until a primary provider has been configured', () => {
    const exaMcp = provider('exa-mcp')

    expect(resolveReadyWebSearchProvider([exaMcp], undefined, 'searchKeywords')).toBeUndefined()
  })

  it('uses the fixed keyless provider when the primary capability is not ready', () => {
    const tavily = provider('tavily')
    const exaMcp = provider('exa-mcp')
    const querit = provider('querit')
    const fetch = provider('fetch')

    expect(resolveReadyWebSearchProvider([tavily, exaMcp], tavily, 'searchKeywords')).toBe(exaMcp)
    expect(resolveReadyWebSearchProvider([querit, fetch], querit, 'fetchUrls')).toBe(fetch)
  })

  it('reports the client capability unavailable when neither primary nor fallback is ready', () => {
    const tavily = provider('tavily')
    const exaMcp = provider('exa-mcp')
    exaMcp.capabilities = [{ ...exaMcp.capabilities[0], apiHost: '' }]

    expect(resolveReadyWebSearchProvider([tavily, exaMcp], tavily, 'searchKeywords')).toBeUndefined()
  })
})
