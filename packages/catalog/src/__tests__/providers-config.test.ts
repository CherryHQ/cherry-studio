/**
 * Test provider configs with models_api
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ProviderConfigSchema } from '../schemas/provider'

describe('Provider configs with models_api', () => {
  const providersData = JSON.parse(readFileSync('./data/providers.json', 'utf8'))

  it('should have valid OpenRouter config with models_api', () => {
    const openrouter = providersData.providers.find((p: any) => p.id === 'openrouter')
    expect(openrouter).toBeDefined()

    // Validate schema
    const result = ProviderConfigSchema.safeParse(openrouter)
    if (!result.success) {
      console.error('Validation errors:', result.error.errors)
    }
    expect(result.success).toBe(true)

    // Check models_api config
    expect(openrouter.models_api).toBeDefined()
    expect(openrouter.models_api.enabled).toBe(true)
    expect(openrouter.models_api.endpoints).toHaveLength(1)
    expect(openrouter.models_api.endpoints[0].url).toBe('https://openrouter.ai/api/v1/models')
    expect(openrouter.models_api.endpoints[0].transformer).toBe('openrouter')
  })

  it('should have valid AiHubMix config with models_api', () => {
    const aihubmix = providersData.providers.find((p: any) => p.id === 'aihubmix')
    expect(aihubmix).toBeDefined()

    // Validate schema
    const result = ProviderConfigSchema.safeParse(aihubmix)
    if (!result.success) {
      console.error('Validation errors:', result.error.errors)
    }
    expect(result.success).toBe(true)

    // Check models_api config
    expect(aihubmix.models_api).toBeDefined()
    expect(aihubmix.models_api.enabled).toBe(true)
    expect(aihubmix.models_api.endpoints).toHaveLength(1)
    expect(aihubmix.models_api.endpoints[0].url).toBe('https://aihubmix.com/v1/models')
    expect(aihubmix.models_api.endpoints[0].transformer).toBe('aihubmix')
  })

  it('should have 14 providers with models_api configured', () => {
    const withModelsApi = providersData.providers.filter((p: any) => p.models_api)
    expect(withModelsApi.length).toBe(14)
  })

  it('should validate all providers with models_api', () => {
    const withModelsApi = providersData.providers.filter((p: any) => p.models_api)
    const failures: string[] = []

    for (const provider of withModelsApi) {
      const result = ProviderConfigSchema.safeParse(provider)
      if (!result.success) {
        failures.push(`${provider.id}: ${result.error.errors.map((e) => e.message).join(', ')}`)
      }
    }

    if (failures.length > 0) {
      console.error('Validation failures:\n', failures.join('\n'))
    }
    expect(failures).toHaveLength(0)
  })

  it('should have correct endpoint structure for all models_api configs', () => {
    const withModelsApi = providersData.providers.filter((p: any) => p.models_api)

    for (const provider of withModelsApi) {
      expect(provider.models_api.endpoints).toBeInstanceOf(Array)
      expect(provider.models_api.endpoints.length).toBeGreaterThan(0)
      expect(provider.models_api.enabled).toBe(true)

      for (const endpoint of provider.models_api.endpoints) {
        expect(endpoint.url).toBeDefined()
        expect(endpoint.url).toMatch(/^https?:\/\//)
        expect(endpoint.endpoint_type).toBeDefined()
        expect(endpoint.format).toBeDefined()
      }
    }
  })
})
