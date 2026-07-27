import type { RuntimeModelPricing } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { computeLanguageCost } from '../costComputation'

const pricing = (overrides: Partial<RuntimeModelPricing> = {}): RuntimeModelPricing => ({
  input: { perMillionTokens: 3, currency: 'USD' },
  output: { perMillionTokens: 15, currency: 'USD' },
  ...overrides
})

describe('computeLanguageCost', () => {
  it('prices input and output at their rates', () => {
    expect(computeLanguageCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, pricing())).toEqual({
      cost: 10.5,
      breakdown: { input: 3, output: 7.5 },
      currency: 'USD'
    })
  })

  it('uses the complete cache breakdown without double-pricing input', () => {
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

    expect(result?.breakdown).toEqual({ input: 0.6, cacheRead: 0.21, cacheWrite: 0.375, output: 0 })
    expect(result?.cost).toBeCloseTo(1.185, 10)
  })

  it('derives regular input from a partial cache breakdown', () => {
    const result = computeLanguageCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        inputTokenDetails: { cacheReadTokens: 700_000 }
      },
      pricing({ cacheRead: { perMillionTokens: 0.3, currency: 'USD' } })
    )

    expect(result?.breakdown).toEqual({ input: 0.9, cacheRead: 0.21, output: 0 })
    expect(result?.cost).toBeCloseTo(1.11, 10)
  })

  it('clamps the derived regular input when cache details exceed the total', () => {
    const result = computeLanguageCost(
      {
        inputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 120, cacheWriteTokens: 30 }
      },
      pricing()
    )

    expect(result?.breakdown.input).toBe(0)
  })

  it('falls back to the input rate when a dedicated cache rate is absent', () => {
    const result = computeLanguageCost(
      { inputTokens: 1_000_000, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 1_000_000 } },
      pricing()
    )
    expect(result?.breakdown).toEqual({ input: 0, cacheRead: 3, output: 0 })
  })

  it('returns undefined when no bucket can be priced', () => {
    expect(
      computeLanguageCost(
        { inputTokens: 1000, outputTokens: 1000 },
        { input: { perMillionTokens: null }, output: { perMillionTokens: null } }
      )
    ).toBeUndefined()
    expect(computeLanguageCost({}, pricing())).toBeUndefined()
  })

  it('skips non-finite rates', () => {
    const result = computeLanguageCost(
      { inputTokens: 1000, outputTokens: 1000 },
      { input: { perMillionTokens: Number.NaN }, output: { perMillionTokens: 15, currency: 'USD' } }
    )
    expect(result?.breakdown).not.toHaveProperty('input')
    expect(result?.cost).toBeCloseTo((1000 * 15) / 1_000_000, 10)
  })

  it('carries the configured currency', () => {
    expect(
      computeLanguageCost(
        { inputTokens: 1_000_000, outputTokens: 0 },
        pricing({ input: { perMillionTokens: 3, currency: 'CNY' } })
      )?.currency
    ).toBe('CNY')
  })
})
