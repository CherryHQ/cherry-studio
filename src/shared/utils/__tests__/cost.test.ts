import type { RuntimeModelPricing } from '@shared/data/types/model'
import { computeLanguageCost, extractProviderCost } from '@shared/utils/cost'
import { describe, expect, it } from 'vitest'

const pricing = (overrides: Partial<RuntimeModelPricing> = {}): RuntimeModelPricing => ({
  input: { perMillionTokens: 3, currency: 'USD' },
  output: { perMillionTokens: 15, currency: 'USD' },
  ...overrides
})

describe('computeLanguageCost', () => {
  it('prices input + output at their rates', () => {
    const result = computeLanguageCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, pricing())
    expect(result).toEqual({
      cost: 3 + 7.5,
      breakdown: { input: 3, output: 7.5 },
      currency: 'USD'
    })
  })

  it('uses noCacheTokens for the input bucket and dedicated cache rates', () => {
    const result = computeLanguageCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        inputTokenDetails: { noCacheTokens: 200_000, cacheReadTokens: 700_000, cacheWriteTokens: 100_000 }
      },
      pricing({
        cacheRead: { perMillionTokens: 0.3, currency: 'USD' },
        cacheWrite: { perMillionTokens: 3.75, currency: 'USD' }
      })
    )
    expect(result?.breakdown).toEqual({
      input: (200_000 * 3) / 1_000_000,
      cacheRead: (700_000 * 0.3) / 1_000_000,
      cacheWrite: (100_000 * 3.75) / 1_000_000,
      output: 0
    })
    expect(result?.cost).toBeCloseTo(0.6 + 0.21 + 0.375 + 0, 10)
  })

  it('falls back to the input rate when a dedicated cache rate is absent', () => {
    const result = computeLanguageCost(
      { inputTokens: 0, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 1_000_000 } },
      pricing()
    )
    // No dedicated cacheRead rate → falls back to input rate (3).
    expect(result?.breakdown.cacheRead).toBe(3)
  })

  it('returns undefined when no bucket can be priced (rates null)', () => {
    const result = computeLanguageCost(
      { inputTokens: 1000, outputTokens: 1000 },
      { input: { perMillionTokens: null }, output: { perMillionTokens: null } }
    )
    expect(result).toBeUndefined()
  })

  it('returns undefined when there is no usable token data', () => {
    expect(computeLanguageCost({}, pricing())).toBeUndefined()
  })

  it('carries the configured currency', () => {
    const result = computeLanguageCost(
      { inputTokens: 1_000_000, outputTokens: 0 },
      pricing({ input: { perMillionTokens: 3, currency: 'CNY' }, output: { perMillionTokens: 15, currency: 'CNY' } })
    )
    expect(result?.currency).toBe('CNY')
  })
})

describe('extractProviderCost', () => {
  it('reads a top-level cost', () => {
    expect(extractProviderCost({ cost: 0.0123 })).toBe(0.0123)
  })

  it('reads a nested usage.cost', () => {
    expect(extractProviderCost({ usage: { cost: 0.5 } })).toBe(0.5)
  })

  it('ignores non-finite / missing / non-object input', () => {
    expect(extractProviderCost(undefined)).toBeUndefined()
    expect(extractProviderCost({})).toBeUndefined()
    expect(extractProviderCost({ cost: 'free' as unknown as number })).toBeUndefined()
    expect(extractProviderCost({ cost: Number.NaN })).toBeUndefined()
  })
})
