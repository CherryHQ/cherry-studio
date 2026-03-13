import { describe, expect, it } from 'vitest'

import {
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
      usingBrowser: false,
      defaultApiHost: 'https://example.com'
    })

    expect(result.success).toBe(false)
  })

  it('accepts valid provider overrides', () => {
    const result = WebSearchProviderOverridesSchema.safeParse({
      tavily: {
        apiKey: 'key',
        apiHost: 'https://api.tavily.com',
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
        apiKey: 'key',
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
        apiKey: 'key'
      }
    })

    expect(idResult.success).toBe(false)
    expect(overridesResult.success).toBe(false)
  })
})
