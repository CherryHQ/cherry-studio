import { describe, expect, it } from 'vitest'

import { WEB_SEARCH_PROVIDER_IDS } from '../data/preference/preferenceTypes'
import {
  findWebSearchCapability,
  PRESETS_WEB_SEARCH_PROVIDERS,
  WebSearchProviderIdSchema,
  WebSearchProviderOverrideSchema,
  WebSearchProviderOverridesSchema,
  WebSearchProviderPresetDefinitionSchema,
  WebSearchProviderTypeSchema
} from '../data/presets/web-search-providers'

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

  it('models Jina as one provider with keyword search and URL fetch capabilities', () => {
    expect(WEB_SEARCH_PROVIDER_IDS).toContain('jina')
    expect(WEB_SEARCH_PROVIDER_IDS).not.toContain('jina-reader')

    const jina = PRESETS_WEB_SEARCH_PROVIDERS.find((preset) => preset.id === 'jina')

    expect(jina).toBeDefined()
    expect(findWebSearchCapability(jina!, 'searchKeywords')?.apiHost).toBe('https://s.jina.ai')
    expect(findWebSearchCapability(jina!, 'fetchUrls')?.apiHost).toBe('https://r.jina.ai')
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
