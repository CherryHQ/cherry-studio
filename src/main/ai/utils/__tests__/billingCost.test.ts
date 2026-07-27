import type { RuntimeModelPricing } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { computeImageCost, extractProviderCost } from '../billingCost'

const pricing = (overrides: Partial<RuntimeModelPricing> = {}): RuntimeModelPricing => ({
  input: { perMillionTokens: 3, currency: 'USD' },
  output: { perMillionTokens: 15, currency: 'USD' },
  ...overrides
})

describe('computeImageCost', () => {
  it('prices each successfully generated image', () => {
    expect(computeImageCost(3, pricing({ perImage: { price: 0.04 } }))).toEqual({
      cost: 0.12,
      currency: 'USD'
    })
  })

  it('rejects unsupported or empty image pricing', () => {
    expect(computeImageCost(1, pricing({ perImage: { price: 0.000001, unit: 'pixel' } }))).toBeUndefined()
    expect(computeImageCost(1, pricing())).toBeUndefined()
    expect(computeImageCost(0, pricing({ perImage: { price: 0.04 } }))).toBeUndefined()
  })
})

describe('extractProviderCost', () => {
  it('reads supported provider cost shapes', () => {
    expect(extractProviderCost({ cost: 0.0123 })).toBe(0.0123)
    expect(extractProviderCost({ usage: { cost: 0.5 } })).toBe(0.5)
  })

  it('ignores invalid provider cost values', () => {
    expect(extractProviderCost(undefined)).toBeUndefined()
    expect(extractProviderCost({})).toBeUndefined()
    expect(extractProviderCost({ cost: 'free' })).toBeUndefined()
    expect(extractProviderCost({ cost: Number.NaN })).toBeUndefined()
  })
})
