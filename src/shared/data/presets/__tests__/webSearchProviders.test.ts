import { describe, expect, it } from 'vitest'

import { WEB_SEARCH_PROVIDER_CATALOG } from '@cherrystudio/web-search/catalog'

import { WEB_SEARCH_PROVIDER_IDS } from '../../preference/preferenceTypes'
import {
  PRESETS_WEB_SEARCH_PROVIDERS,
  WebSearchProviderIdSchema,
  WebSearchProviderOverrideSchema,
  WebSearchProviderOverridesSchema,
  WebSearchProviderPresetDefinitionSchema,
  WebSearchProviderTypeSchema
} from '../webSearchProviders'

describe('web search provider schemas', () => {
  it('accepts the current preset list', () => {
    expect(PRESETS_WEB_SEARCH_PROVIDERS.length).toBeGreaterThan(0)
    expect(PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => preset.id)).toEqual(WEB_SEARCH_PROVIDER_IDS)

    PRESETS_WEB_SEARCH_PROVIDERS.forEach((preset) => {
      expect(WebSearchProviderPresetDefinitionSchema.safeParse(preset).success).toBe(true)
      expect(WebSearchProviderTypeSchema.safeParse(preset.type).success).toBe(true)
      expect(WebSearchProviderIdSchema.safeParse(preset.id).success).toBe(true)
    })
  })

  it('rejects invalid preset types', () => {
    const result = WebSearchProviderPresetDefinitionSchema.safeParse({
      id: 'custom',
      name: 'Custom',
      type: 'custom',
      capabilities: [{ feature: 'searchKeywords', apiHost: 'https://example.com' }]
    })

    expect(result.success).toBe(false)
  })

  it('keeps Exa MCP fetching disabled on Desktop even though the shared protocol supports it', () => {
    expect(WEB_SEARCH_PROVIDER_CATALOG['exa-mcp'].capabilities.some((item) => item.capability === 'fetchUrls')).toBe(
      true
    )
    const exaMcp = PRESETS_WEB_SEARCH_PROVIDERS.find((provider) => provider.id === 'exa-mcp')
    expect(exaMcp?.capabilities.map((item) => item.feature)).toEqual(['searchKeywords'])
  })

  it('models Jina as one provider with keyword search and URL fetch capabilities', () => {
    expect(WEB_SEARCH_PROVIDER_IDS).toContain('jina')
    expect(WEB_SEARCH_PROVIDER_IDS).not.toContain('jina-reader')

    const jina = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'jina')

    expect(jina).toBeDefined()
    expect(jina!.capabilities.find((capability) => capability.feature === 'searchKeywords')?.apiHost).toBe(
      'https://s.jina.ai'
    )
    expect(jina!.capabilities.find((capability) => capability.feature === 'fetchUrls')?.apiHost).toBe(
      'https://r.jina.ai'
    )
  })

  it('models Firecrawl as one provider with keyword search and URL fetch capabilities', () => {
    const firecrawl = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'firecrawl')

    expect(firecrawl).toBeDefined()
    expect(firecrawl!.capabilities.map((capability) => capability.feature)).toEqual(['searchKeywords', 'fetchUrls'])
    expect(firecrawl!.capabilities.find((capability) => capability.feature === 'fetchUrls')).toEqual({
      feature: 'fetchUrls',
      requiresApiHost: true,
      requiresApiKey: false,
      apiHost: 'https://api.firecrawl.dev'
    })
  })

  it('defaults Crawl4AI to the hosted Cloud host while keeping anonymous self-hosted fetching available', () => {
    const crawl4ai = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'crawl4ai')

    expect(crawl4ai?.capabilities).toEqual([
      { feature: 'fetchUrls', requiresApiHost: true, requiresApiKey: false, apiHost: 'https://api.crawl4ai.com' }
    ])
    expect(
      WebSearchProviderOverridesSchema.safeParse({
        crawl4ai: { capabilities: { fetchUrls: { apiHost: 'http://localhost:11235' } }, apiKeys: [] }
      }).success
    ).toBe(true)
  })

  it('models Parallel as an API-key-authenticated keyword search provider', () => {
    const parallel = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'parallel')

    expect(parallel).toBeDefined()
    expect(parallel!.capabilities).toEqual([
      {
        feature: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        apiHost: 'https://api.parallel.ai'
      }
    ])
  })

  it('models Serply as an API-key-authenticated keyword search provider', () => {
    const serply = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'serply')

    expect(serply).toBeDefined()
    expect(serply!.capabilities).toEqual([
      {
        feature: 'searchKeywords',
        requiresApiHost: true,
        requiresApiKey: true,
        apiHost: 'https://api.serply.io'
      }
    ])
  })

  it('models Fetch as a hostless built-in URL fetch provider', () => {
    const fetch = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'fetch')

    expect(fetch).toBeDefined()
    expect(fetch!.capabilities.find((capability) => capability.feature === 'fetchUrls')).toEqual({
      feature: 'fetchUrls',
      requiresApiHost: false,
      requiresApiKey: false
    })
  })

  it('models Searxng with a localhost default host', () => {
    const searxng = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'searxng')

    expect(searxng).toBeDefined()
    expect(searxng!.capabilities.find((capability) => capability.feature === 'searchKeywords')?.apiHost).toBe(
      'http://localhost:8080'
    )
  })

  it('models Duckduckgo as a hostless keyless keyword search provider', () => {
    const duckduckgo = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'duckduckgo')

    expect(duckduckgo).toBeDefined()
    expect(duckduckgo!.capabilities).toEqual([
      { feature: 'searchKeywords', requiresApiHost: false, requiresApiKey: false }
    ])
  })

  it('accepts valid provider overrides', () => {
    const result = WebSearchProviderOverridesSchema.safeParse({
      tavily: {
        apiKeys: ['key1', 'key2'],
        capabilities: {
          searchKeywords: {
            apiHost: 'https://api.tavily.com'
          }
        },
        engines: ['news'],
        basicAuthUsername: 'user',
        basicAuthPassword: 'pass'
      }
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid provider override fields', () => {
    const singleOverrideResult = WebSearchProviderOverrideSchema.safeParse({
      engines: [1]
    })

    const overridesResult = WebSearchProviderOverridesSchema.safeParse({
      tavily: {
        apiKeys: ['key', 1],
        engines: [1]
      }
    })

    expect(singleOverrideResult.success).toBe(false)
    expect(overridesResult.success).toBe(false)
  })

  it('rejects unknown provider override keys', () => {
    const idResult = WebSearchProviderIdSchema.safeParse('custom-provider')
    const overridesResult = WebSearchProviderOverridesSchema.safeParse({
      'custom-provider': {
        apiKeys: ['key']
      }
    })

    expect(idResult.success).toBe(false)
    expect(overridesResult.success).toBe(false)
  })
})

it('accepts saved Yuanbao credentials and exposes only keyword search', () => {
  expect(
    WebSearchProviderOverridesSchema.safeParse({
      yuanbao: { apiKeys: ['key'], capabilities: { searchKeywords: { apiHost: 'https://proxy.example' } } }
    }).success
  ).toBe(true)
  const preset = PRESETS_WEB_SEARCH_PROVIDERS.find((item) => item.id === 'yuanbao')
  expect(preset?.capabilities).toEqual([
    {
      feature: 'searchKeywords',
      requiresApiHost: true,
      requiresApiKey: true,
      apiHost: 'https://api.wsa.cloud.tencent.com'
    }
  ])
})
