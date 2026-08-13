import { RuntimeModelPricingSchema } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

const basePricing = {
  input: { perMillionTokens: 1, currency: 'USD' as const },
  output: { perMillionTokens: 2, currency: 'USD' as const }
}

function inputTokenTier(minInputTokens: number) {
  return {
    minInputTokens,
    input: { perMillionTokens: 10, currency: 'USD' as const },
    output: { perMillionTokens: 20, currency: 'USD' as const }
  }
}

describe('RuntimeModelPricingSchema input-token tiers', () => {
  it('keeps legacy flat mixed-currency pricing valid when no tiers are configured', () => {
    expect(
      RuntimeModelPricingSchema.safeParse({
        input: { perMillionTokens: 1, currency: 'USD' },
        output: { perMillionTokens: 2, currency: 'CNY' }
      }).success
    ).toBe(true)
  })

  it('accepts strictly increasing input-token thresholds', () => {
    expect(
      RuntimeModelPricingSchema.safeParse({
        ...basePricing,
        inputTokenTiers: [inputTokenTier(1_000), inputTokenTier(2_000)]
      }).success
    ).toBe(true)
  })

  it.each([
    ['out-of-order', [inputTokenTier(2_000), inputTokenTier(1_000)]],
    ['duplicate', [inputTokenTier(1_000), inputTokenTier(1_000)]]
  ])('rejects %s input-token thresholds', (_label, inputTokenTiers) => {
    expect(RuntimeModelPricingSchema.safeParse({ ...basePricing, inputTokenTiers }).success).toBe(false)
  })

  it('rejects unsafe thresholds and mixed currencies across tiers', () => {
    expect(
      RuntimeModelPricingSchema.safeParse({
        ...basePricing,
        inputTokenTiers: [inputTokenTier(Number.MAX_SAFE_INTEGER + 1)]
      }).success
    ).toBe(false)

    expect(
      RuntimeModelPricingSchema.safeParse({
        ...basePricing,
        inputTokenTiers: [
          {
            ...inputTokenTier(1_000),
            output: { perMillionTokens: 20, currency: 'CNY' }
          }
        ]
      }).success
    ).toBe(false)
  })

  it.each([0, -1, 1.5])('rejects a non-positive-integer threshold: %s', (minInputTokens) => {
    expect(
      RuntimeModelPricingSchema.safeParse({
        ...basePricing,
        inputTokenTiers: [inputTokenTier(minInputTokens)]
      }).success
    ).toBe(false)
  })
})
