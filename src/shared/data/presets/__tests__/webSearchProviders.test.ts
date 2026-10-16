import { describe, expect, it } from 'vitest'

import {
  PRESETS_WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_PRESET_MAP,
  WebSearchProviderIdSchema,
  WebSearchProviderOverrideSchema,
  WebSearchProviderOverridesSchema,
  WebSearchProviderPresetDefinitionSchema,
  WebSearchProviderTypeSchema
} from '../webSearchProviders'

describe('web search provider schemas', () => {
  it('accepts the current preset list', () => {
    expect(PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => preset.id)).toEqual([
      'zhipu',
      'tavily',
      'searxng',
      'exa',
      'exa-mcp',
      'bocha',
      'querit',
      'fetch',
      'jina',
      'firecrawl',
      'crawl4ai',
      'parallel',
      'serply',
      'duckduckgo'
    ])

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

  it('preserves Desktop display names, endpoint properties, requirements and capability allowlists', () => {
    expect(WEB_SEARCH_PROVIDER_PRESET_MAP).toEqual({
      zhipu: {
        name: 'Zhipu',
        type: 'api',
        capabilities: [
          {
            feature: 'searchKeywords',
            requiresApiHost: true,
            requiresApiKey: true,
            apiHost: 'https://open.bigmodel.cn/api/paas/v4/web_search'
          }
        ]
      },
      tavily: {
        name: 'Tavily',
        type: 'api',
        capabilities: [
          { feature: 'searchKeywords', requiresApiHost: true, requiresApiKey: true, apiHost: 'https://api.tavily.com' }
        ]
      },
      searxng: {
        name: 'Searxng',
        type: 'api',
        capabilities: [
          { feature: 'searchKeywords', requiresApiHost: true, requiresApiKey: false, apiHost: 'http://localhost:8080' }
        ]
      },
      exa: {
        name: 'Exa',
        type: 'api',
        capabilities: [
          { feature: 'searchKeywords', requiresApiHost: true, requiresApiKey: true, apiHost: 'https://api.exa.ai' }
        ]
      },
      'exa-mcp': {
        name: 'ExaMCP',
        type: 'mcp',
        capabilities: [
          {
            feature: 'searchKeywords',
            requiresApiHost: true,
            requiresApiKey: false,
            apiHost: 'https://mcp.exa.ai/mcp'
          }
        ]
      },
      bocha: {
        name: 'Bocha',
        type: 'api',
        capabilities: [
          { feature: 'searchKeywords', requiresApiHost: true, requiresApiKey: true, apiHost: 'https://api.bochaai.com' }
        ]
      },
      querit: {
        name: 'Querit',
        type: 'api',
        capabilities: [
          { feature: 'searchKeywords', requiresApiHost: true, requiresApiKey: true, apiHost: 'https://api.querit.ai' },
          { feature: 'fetchUrls', requiresApiHost: true, requiresApiKey: true, apiHost: 'https://api.querit.ai' }
        ]
      },
      fetch: {
        name: 'fetch',
        type: 'api',
        capabilities: [{ feature: 'fetchUrls', requiresApiHost: false, requiresApiKey: false }]
      },
      jina: {
        name: 'Jina',
        type: 'api',
        capabilities: [
          { feature: 'searchKeywords', requiresApiHost: true, requiresApiKey: true, apiHost: 'https://s.jina.ai' },
          { feature: 'fetchUrls', requiresApiHost: true, requiresApiKey: false, apiHost: 'https://r.jina.ai' }
        ]
      },
      firecrawl: {
        name: 'Firecrawl',
        type: 'api',
        capabilities: [
          {
            feature: 'searchKeywords',
            requiresApiHost: true,
            requiresApiKey: false,
            apiHost: 'https://api.firecrawl.dev'
          },
          {
            feature: 'fetchUrls',
            requiresApiHost: true,
            requiresApiKey: false,
            apiHost: 'https://api.firecrawl.dev'
          }
        ]
      },
      crawl4ai: {
        name: 'Crawl4AI',
        type: 'api',
        capabilities: [{ feature: 'fetchUrls', requiresApiHost: true, requiresApiKey: false, apiHost: '' }]
      },
      parallel: {
        name: 'Parallel',
        type: 'api',
        capabilities: [
          {
            feature: 'searchKeywords',
            requiresApiHost: true,
            requiresApiKey: true,
            apiHost: 'https://api.parallel.ai'
          }
        ]
      },
      duckduckgo: {
        name: 'DuckDuckGo',
        type: 'api',
        capabilities: [{ feature: 'searchKeywords', requiresApiHost: false, requiresApiKey: false }]
      },
      serply: {
        name: 'Serply',
        type: 'api',
        capabilities: [
          {
            feature: 'searchKeywords',
            requiresApiHost: true,
            requiresApiKey: true,
            apiHost: 'https://api.serply.io'
          }
        ]
      }
    })
    expect(Object.hasOwn(WEB_SEARCH_PROVIDER_PRESET_MAP.crawl4ai.capabilities[0], 'apiHost')).toBe(true)
    expect(WEB_SEARCH_PROVIDER_PRESET_MAP['exa-mcp'].capabilities.map(({ feature }) => feature)).toEqual([
      'searchKeywords'
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
