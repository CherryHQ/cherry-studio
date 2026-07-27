import { computeLanguageCost } from '@main/data/services/utils/costComputation'
import { CURRENCY } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { normalizeGatewayUsage } from '../gatewayUsageNormalize'

describe('normalizeGatewayUsage', () => {
  it('derives the non-cached remainder from the prompt total', () => {
    expect(normalizeGatewayUsage({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50 })).toEqual({
      inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: undefined },
      outputTokens: { total: 50, text: undefined, reasoning: undefined }
    })
  })

  it('leaves the remainder unknown when either side is missing', () => {
    expect(normalizeGatewayUsage({ inputTokens: 1000 }).inputTokens.noCache).toBeUndefined()
    expect(normalizeGatewayUsage({ cachedInputTokens: 800 }).inputTokens.noCache).toBeUndefined()
  })

  it('floors the remainder at zero if a provider reports more cached than total', () => {
    expect(normalizeGatewayUsage({ inputTokens: 100, cachedInputTokens: 150 }).inputTokens.noCache).toBe(0)
  })

  it('prices the cached tokens once', () => {
    const usage = normalizeGatewayUsage({ inputTokens: 1000, cachedInputTokens: 800, outputTokens: 0 })
    const cost = computeLanguageCost(
      {
        inputTokens: usage.inputTokens.total,
        outputTokens: usage.outputTokens.total,
        inputTokenDetails: {
          noCacheTokens: usage.inputTokens.noCache,
          cacheReadTokens: usage.inputTokens.cacheRead,
          cacheWriteTokens: usage.inputTokens.cacheWrite
        }
      },
      {
        input: { perMillionTokens: 10, currency: CURRENCY.USD },
        output: { perMillionTokens: 30, currency: CURRENCY.USD },
        cacheRead: { perMillionTokens: 1, currency: CURRENCY.USD }
      }
    )

    // 200 fresh @ $10/M + 800 cached @ $1/M — not 1000 @ $10/M plus the cache bucket.
    expect(cost?.cost).toBeCloseTo(0.0028)
  })
})
