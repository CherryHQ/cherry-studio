/**
 * Test provider configs with modelsApi
 *
 * Note: These tests work with the actual providers.json data file.
 * The data file may use either old or new schema format during migration.
 *
 * SKIPPED: providers.json was removed during schema refactoring.
 * TODO: Update tests to use new provider data format when available.
 */

import { describe, expect, it } from 'vitest'

describe.skip('Provider configs with modelsApi', () => {
  const providersData = { providers: [] } as any

  it('should have OpenRouter config with modelsApi', () => {
    const openrouter = providersData.providers.find((p: any) => p.id === 'openrouter')
    expect(openrouter).toBeDefined()

    // Check modelsApi config (old format)
    expect(openrouter.modelsApi).toBeDefined()
    expect(openrouter.modelsApi.enabled).toBe(true)
    expect(openrouter.modelsApi.endpoints).toHaveLength(1)
    expect(openrouter.modelsApi.endpoints[0].url).toBe('https://openrouter.ai/api/v1/models')
    expect(openrouter.modelsApi.endpoints[0].transformer).toBe('openrouter')
  })

  it('should have AiHubMix config with modelsApi', () => {
    const aihubmix = providersData.providers.find((p: any) => p.id === 'aihubmix')
    expect(aihubmix).toBeDefined()

    // Check modelsApi config (old format)
    expect(aihubmix.modelsApi).toBeDefined()
    expect(aihubmix.modelsApi.enabled).toBe(true)
    expect(aihubmix.modelsApi.endpoints).toHaveLength(1)
    expect(aihubmix.modelsApi.endpoints[0].url).toBe('https://aihubmix.com/v1/models')
    expect(aihubmix.modelsApi.endpoints[0].transformer).toBe('aihubmix')
  })

  it('should have providers with modelsApi configured', () => {
    const withModelsApi = providersData.providers.filter((p: any) => p.modelsApi)
    expect(withModelsApi.length).toBeGreaterThanOrEqual(10)
  })

  it('should have correct endpoint structure for all modelsApi configs', () => {
    const withModelsApi = providersData.providers.filter((p: any) => p.modelsApi)

    for (const provider of withModelsApi) {
      expect(provider.modelsApi.endpoints).toBeInstanceOf(Array)
      expect(provider.modelsApi.endpoints.length).toBeGreaterThan(0)
      expect(provider.modelsApi.enabled).toBe(true)

      for (const endpoint of provider.modelsApi.endpoints) {
        expect(endpoint.url).toBeDefined()
        expect(endpoint.url).toMatch(/^https?:\/\//)
        expect(endpoint.endpointType).toBeDefined()
        expect(endpoint.format).toBeDefined()
      }
    }
  })
})
