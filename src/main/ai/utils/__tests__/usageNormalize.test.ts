import { describe, expect, it } from 'vitest'

import { ensureNestedV3Usage, normalizeFlatV3Usage, recordTotalTokens } from '../usageNormalize'

describe('usageNormalize', () => {
  it('derives the non-cached remainder from the prompt total', () => {
    expect(normalizeFlatV3Usage({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50 })).toEqual({
      inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: undefined },
      outputTokens: { total: 50, text: undefined, reasoning: undefined }
    })
  })

  it('leaves the remainder unknown when either side is missing', () => {
    expect(normalizeFlatV3Usage({ inputTokens: 1000 }).inputTokens.noCache).toBeUndefined()
    expect(normalizeFlatV3Usage({ cachedInputTokens: 800 }).inputTokens.noCache).toBeUndefined()
  })

  it('floors the remainder at zero if a provider reports more cached than total', () => {
    expect(normalizeFlatV3Usage({ inputTokens: 100, cachedInputTokens: 150 }).inputTokens.noCache).toBe(0)
  })

  it('leaves already-nested usage unchanged', () => {
    const nested = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined }
    }
    expect(ensureNestedV3Usage(nested)).toEqual(nested)
  })

  it('normalizes flat usage for persistence callers', () => {
    expect(ensureNestedV3Usage({ inputTokens: 80, outputTokens: 12, cachedInputTokens: 20 } as never)).toEqual({
      inputTokens: { total: 80, noCache: 60, cacheRead: 20, cacheWrite: undefined },
      outputTokens: { total: 12, text: undefined, reasoning: undefined }
    })
  })

  it('maps flat reasoning tokens into the nested output bucket', () => {
    expect(ensureNestedV3Usage({ inputTokens: 10, outputTokens: 5, reasoningTokens: 3 } as never)).toMatchObject({
      outputTokens: { total: 5, reasoning: 3 }
    })
  })

  it('preserves provider raw cost metadata when normalizing flat usage', () => {
    const raw = { cost: 0.0123, currency: 'USD' }
    expect(normalizeFlatV3Usage({ inputTokens: 10, outputTokens: 5, raw })).toEqual({
      inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: undefined, reasoning: undefined },
      raw
    })
  })

  it('prefers the provider flat total when input and output are absent', () => {
    expect(recordTotalTokens({ totalTokens: 42 } as never, undefined, undefined)).toBe(42)
  })

  it('falls back to the input/output sum when flat total is absent', () => {
    expect(recordTotalTokens({ inputTokens: 10, outputTokens: 5 } as never, 10, 5)).toBe(15)
  })
})
