/**
 * Unit tests for `enrichStatsWithCost` — the cost-resolution step shared by
 * message persistence and the usage ledger. Default is computed-from-pricing;
 * a provider-reported figure is trusted only when the provider is flagged
 * `apiFeatures.reportsActualCost`.
 */

import type { MessageStats } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getByKeyMock = vi.fn()
const getByProviderIdMock = vi.fn()

vi.mock('@main/data/services/ModelService', () => ({ modelService: { getByKey: getByKeyMock } }))
vi.mock('@main/data/services/ProviderService', () => ({ providerService: { getByProviderId: getByProviderIdMock } }))

const { enrichStatsWithCost } = await import('../costEnrichment')

const tokenStats: MessageStats = {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 900,
  inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 700, cacheWriteTokens: 100 }
}

const usdModel = {
  pricing: {
    input: { perMillionTokens: 3, currency: 'USD' },
    output: { perMillionTokens: 15, currency: 'USD' },
    cacheRead: { perMillionTokens: 0.3, currency: 'USD' },
    cacheWrite: { perMillionTokens: 3.75, currency: 'USD' }
  }
}

beforeEach(() => {
  getByKeyMock.mockReset()
  getByProviderIdMock.mockReset()
  getByProviderIdMock.mockResolvedValue({ apiFeatures: { reportsActualCost: false } })
})

describe('enrichStatsWithCost', () => {
  it('returns input unchanged when stats or modelId is missing', async () => {
    expect(await enrichStatsWithCost(undefined, 'openai::gpt-4o' as UniqueModelId, undefined)).toBeUndefined()
    expect(await enrichStatsWithCost(tokenStats, undefined, undefined)).toBe(tokenStats)
  })

  it('computes cost from pricing when the provider is not flagged reliable', async () => {
    getByKeyMock.mockResolvedValue(usdModel)
    const result = await enrichStatsWithCost(tokenStats, 'openai::gpt-4o' as UniqueModelId, undefined)
    expect(result?.costSource).toBe('computed')
    expect(result?.costCurrency).toBe('USD')
    expect(result?.cost).toBeGreaterThan(0)
    expect(result?.costBreakdown).toMatchObject({ input: expect.any(Number), cacheRead: expect.any(Number) })
    expect(result?.pricingSnapshot?.capturedAt).toBeTruthy()
    // token fields preserved, input not mutated
    expect(result?.inputTokens).toBe(100)
    expect(tokenStats).not.toHaveProperty('cost')
  })

  it('trusts provider-reported cost when reportsActualCost is set', async () => {
    getByKeyMock.mockResolvedValue(usdModel)
    getByProviderIdMock.mockResolvedValue({ apiFeatures: { reportsActualCost: true } })
    const result = await enrichStatsWithCost(tokenStats, 'openrouter::x' as UniqueModelId, 0.99)
    expect(result?.cost).toBe(0.99)
    expect(result?.costSource).toBe('provider')
    expect(result?.costCurrency).toBe('USD')
    // USD pricing → cross-check breakdown + snapshot still attached
    expect(result?.costBreakdown).toBeDefined()
    expect(result?.pricingSnapshot?.capturedAt).toBeTruthy()
  })

  it('computes (not provider) when flagged reliable but no providerCostUsd is present', async () => {
    getByKeyMock.mockResolvedValue(usdModel)
    getByProviderIdMock.mockResolvedValue({ apiFeatures: { reportsActualCost: true } })
    const result = await enrichStatsWithCost(tokenStats, 'openrouter::x' as UniqueModelId, undefined)
    expect(result?.costSource).toBe('computed')
  })

  it('leaves cost unset when the model has no pricing', async () => {
    getByKeyMock.mockResolvedValue({ pricing: undefined })
    const result = await enrichStatsWithCost(tokenStats, 'openai::gpt-4o' as UniqueModelId, undefined)
    expect(result).toBe(tokenStats)
    expect(result?.costSource).toBeUndefined()
  })

  it('is best-effort: a model lookup failure leaves token stats untouched', async () => {
    getByKeyMock.mockRejectedValue(new Error('not found'))
    const result = await enrichStatsWithCost(tokenStats, 'openai::gpt-4o' as UniqueModelId, undefined)
    expect(result).toBe(tokenStats)
  })
})
