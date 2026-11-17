import { describe, expect, it } from 'vitest'

import { getProviderLabelKey } from '@renderer/i18n/label'
import type { Model } from '@shared/data/types/model'

import providerModels from '../../../../../../../../packages/provider-registry/data/provider-models.json'
import { createModelPricingDraft } from '../modelPricing'

describe('Fortytwo price editor consumer', () => {
  it('resolves the built-in provider label key', () => {
    expect(getProviderLabelKey('fortytwo')).toBe('provider.fortytwo')
  })

  it('displays the provider rates and an explicit free cache-write rate', () => {
    const offer = providerModels.overrides.find((row) => row.providerId === 'fortytwo' && row.modelId === 'qwen3-8-27b')
    expect(offer).toBeDefined()
    const draft = createModelPricingDraft(offer!.pricing as Model['pricing'])
    expect(draft.tiers).toEqual([
      { minInputTokens: '0', inputPrice: '0.425', outputPrice: '2.55', cacheReadPrice: '0.085', cacheWritePrice: '0' }
    ])
  })
})
