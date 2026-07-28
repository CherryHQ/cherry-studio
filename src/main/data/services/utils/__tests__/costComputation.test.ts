import type { AiUsagePricingSnapshot } from '@shared/data/types/aiUsageRecord'
import { describe, expect, it } from 'vitest'

import { computeLanguageCost } from '../costComputation'

const pricing = (overrides: Partial<AiUsagePricingSnapshot> = {}): AiUsagePricingSnapshot => ({
  currency: 'USD',
  inputPerMillionTokens: 3,
  outputPerMillionTokens: 15,
  capturedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

describe('computeLanguageCost', () => {
  it('prices input and output at their rates', () => {
    expect(computeLanguageCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, pricing())).toEqual({
      cost: 10.5,
      breakdown: { input: 3, output: 7.5 }
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
        cacheReadPerMillionTokens: 0.3,
        cacheWritePerMillionTokens: 3.75
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
      pricing({ cacheReadPerMillionTokens: 0.3 })
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
        { currency: 'USD', capturedAt: '2026-01-01T00:00:00.000Z' }
      )
    ).toBeUndefined()
    expect(computeLanguageCost({}, pricing())).toBeUndefined()
  })

  it('does not emit a partial cost when a non-zero bucket has no rate', () => {
    expect(
      computeLanguageCost(
        { inputTokens: 1000, outputTokens: 1000 },
        { currency: 'USD', outputPerMillionTokens: 15, capturedAt: '2026-01-01T00:00:00.000Z' }
      )
    ).toBeUndefined()
  })

  it('keeps an explicit zero-priced invocation', () => {
    expect(computeLanguageCost({ inputTokens: 0, outputTokens: 0 }, pricing())).toEqual({
      cost: 0,
      breakdown: { input: 0, output: 0 }
    })
  })
})
