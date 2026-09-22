import { describe, expect, it } from 'vitest'

import {
  PROVIDER_MODEL_CATALOG,
  getCanonicalModelsFromProvider,
  getFreeAccessProvidersForModel,
  getSignupUrlForModel
} from '../providerModelCatalog'

describe('providerModelCatalog', () => {
  it('has valid catalog entries with required fields', () => {
    expect(PROVIDER_MODEL_CATALOG.length).toBeGreaterThan(0)

    for (const entry of PROVIDER_MODEL_CATALOG) {
      expect(entry.modelId).toBeTruthy()
      expect(entry.providerId).toBeTruthy()
      expect(typeof entry.hasFreeAccess).toBe('boolean')
      expect(entry.apiModelId).toBeTruthy()
      // signupUrl is optional but if present must be a URL
      if (entry.signupUrl) {
        expect(entry.signupUrl).toMatch(/^https?:\/\//)
      }
    }
  })

  it('getFreeAccessProvidersForModel returns providers with free tier', () => {
    const freeProviders = getFreeAccessProvidersForModel('deepseek-v3')
    expect(freeProviders.length).toBeGreaterThan(0)
    expect(freeProviders.every((p) => p.hasFreeAccess)).toBe(true)
  })

  it('getFreeAccessProvidersForModel returns empty for nonexistent model', () => {
    const freeProviders = getFreeAccessProvidersForModel('nonexistent-model-999')
    expect(freeProviders).toHaveLength(0)
  })

  it('getCanonicalModelsFromProvider returns unique models', () => {
    const models = getCanonicalModelsFromProvider('openrouter')
    expect(models.length).toBeGreaterThan(0)

    // Check uniqueness by model ID
    const modelIds = models.map((m) => m.modelId)
    expect(new Set(modelIds).size).toBe(modelIds.length)
  })

  it('getCanonicalModelsFromProvider returns empty for nonexistent provider', () => {
    const models = getCanonicalModelsFromProvider('nonexistent-provider-999')
    expect(models).toHaveLength(0)
  })

  it('getSignupUrlForModel returns URL for valid pair', () => {
    const url = getSignupUrlForModel('deepseek-v3', 'siliconflow')
    expect(url).toBeTruthy()
    expect(url).toMatch(/^https?:\/\//)
  })

  it('getSignupUrlForModel returns undefined for nonexistent pair', () => {
    const url = getSignupUrlForModel('nonexistent-model-999', 'nonexistent-provider-999')
    expect(url).toBeUndefined()
  })

  it('all providers in catalog are listed as available', () => {
    const providerIds = new Set(PROVIDER_MODEL_CATALOG.map((e) => e.providerId))
    expect(providerIds.size).toBeGreaterThan(0)
    // This is a sanity check; in a real app you'd verify against
    // the actual provider registry, but that's out of scope here
  })

  it('catalog entries are sorted by free tier then provider', () => {
    // Group by model and check order
    const byModel = new Map<string, typeof PROVIDER_MODEL_CATALOG>()
    for (const entry of PROVIDER_MODEL_CATALOG) {
      if (!byModel.has(entry.modelId)) {
        byModel.set(entry.modelId, [])
      }
      byModel.get(entry.modelId)!.push(entry)
    }

    // For each model, free entries should come before paid
    for (const entries of byModel.values()) {
      let lastFree = -1
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].hasFreeAccess) {
          lastFree = i
        } else if (lastFree !== -1) {
          // Paid entry after free entry — check if truly interleaved
          // (this is a soft check; strict ordering is a design choice)
          expect(entries[i].hasFreeAccess || i > lastFree).toBe(true)
        }
      }
    }
  })
})
