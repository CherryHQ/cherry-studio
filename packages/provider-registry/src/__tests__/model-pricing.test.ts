import { describe, expect, it } from 'vitest'

import { ModelPricingSchema, PartialModelPricingSchema } from '../schemas/model'

const price = (perMillionTokens: number, currency: 'USD' | 'CNY' = 'USD') => ({ perMillionTokens, currency })

const tier = (minInputTokens: number, currency: 'USD' | 'CNY' = 'USD') => ({
  minInputTokens,
  input: price(10, currency),
  output: price(30, currency)
})

describe('ModelPricingSchema input-token tiers', () => {
  it('accepts strictly increasing tiers in one currency', () => {
    expect(
      ModelPricingSchema.safeParse({
        input: price(1),
        output: price(3),
        inputTokenTiers: [tier(1_000), tier(2_000)]
      }).success
    ).toBe(true)
  })

  it.each([
    ['out-of-order', [tier(2_000), tier(1_000)]],
    ['duplicate', [tier(1_000), tier(1_000)]]
  ])('rejects %s thresholds', (_label, inputTokenTiers) => {
    expect(ModelPricingSchema.safeParse({ input: price(1), output: price(3), inputTokenTiers }).success).toBe(false)
  })

  it('rejects mixed currencies when tiers are configured', () => {
    expect(
      ModelPricingSchema.safeParse({
        input: price(1),
        output: price(3),
        inputTokenTiers: [tier(1_000, 'CNY')]
      }).success
    ).toBe(false)
  })

  it('validates tier invariants in partial provider pricing overrides', () => {
    expect(PartialModelPricingSchema.safeParse({ inputTokenTiers: [tier(1_000), tier(2_000)] }).success).toBe(true)
    expect(PartialModelPricingSchema.safeParse({ inputTokenTiers: [tier(2_000), tier(1_000)] }).success).toBe(false)
  })
})
