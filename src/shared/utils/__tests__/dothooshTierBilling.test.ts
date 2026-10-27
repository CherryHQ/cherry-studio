import { describe, expect, it } from 'vitest'

import { parseDotHooshListings } from '@cherrystudio/provider-registry'

import { computeLanguageCost, createAiUsagePricingSnapshot } from '../usagePricing'

// DotHoosh bills the whole request at a tier only when input STRICTLY exceeds `above_input_tokens`
// (gateway contract: "measured input exceeds a threshold"). Cherry selects tiers inclusively.
describe('DotHoosh long-context tier boundary in usage cost', () => {
  const [model] = parseDotHooshListings({
    openai: {
      data: [
        {
          id: 'tiered',
          pricing: { prompt: '0.000001', completion: '0.000005' },
          pricing_tiers: [{ above_input_tokens: 100000, prompt: '0.000002', completion: '0.00001' }]
        }
      ]
    }
  })
  const snapshot = createAiUsagePricingSnapshot(model.pricing)!
  const cost = (inputTokens: number) => computeLanguageCost({ inputTokens, outputTokens: 1000 }, snapshot)?.cost

  it('bills exactly 100000 input tokens at the base rate', () => {
    expect(cost(100000)).toBeCloseTo(100000 * 1e-6 + 1000 * 5e-6, 9)
  })

  it('bills 99999 input tokens at the base rate', () => {
    expect(cost(99999)).toBeCloseTo(99999 * 1e-6 + 1000 * 5e-6, 9)
  })

  it('bills 100001 input tokens at the tier rate', () => {
    expect(cost(100001)).toBeCloseTo(100001 * 2e-6 + 1000 * 1e-5, 9)
  })

  it('bills a cache write nobody priced at the input price of the tier the request is on', () => {
    const [unpriced] = parseDotHooshListings({
      openai: {
        data: [
          {
            id: 'tiered-cache',
            pricing: { prompt: '0.000001', completion: '0.000005' },
            pricing_tiers: [{ above_input_tokens: 100000, prompt: '0.000002' }]
          }
        ]
      }
    })
    const tiered = createAiUsagePricingSnapshot(unpriced.pricing)!
    const details = (cacheWriteTokens: number) => ({ cacheWriteTokens })
    const total = (inputTokens: number) =>
      computeLanguageCost({ inputTokens, inputTokenDetails: details(50000) }, tiered)?.cost
    expect(total(100000)).toBeCloseTo(100000 * 1e-6, 9)
    expect(total(100001)).toBeCloseTo(100001 * 2e-6, 9)
  })
})
