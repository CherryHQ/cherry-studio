import { describe, expect, it } from 'vitest'

import { ModelSchema } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'
import { BillingResolutionSchema, ProviderBillingSchema } from '@shared/data/types/providerBilling'

import { resolveProviderBilling } from '../providerBilling'
import { getDefaultProviderBilling } from '../providerBillingDefaults'
import { computeLanguageCost, createAiUsagePricingSnapshot } from '../usagePricing'

const provider = ProviderSchema.parse({
  id: 'deepseek',
  name: 'DeepSeek',
  settings: {},
  apiKeys: [],
  authType: 'api-key',
  reportsActualCost: false,
  isEnabled: true,
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://api.deepseek.com' } }
})
const model = ModelSchema.parse({
  id: 'deepseek::deepseek-flash',
  providerId: 'deepseek',
  apiModelId: 'deepseek-flash',
  name: 'Flash',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  pricing: {
    input: { currency: 'USD', perMillionTokens: 0.3 },
    output: { currency: 'USD', perMillionTokens: 1.2 },
    cacheRead: { currency: 'USD', perMillionTokens: 0.006 }
  }
})
const billing = ProviderBillingSchema.parse(getDefaultProviderBilling(provider, model))
const priceAt = (date: string | null) =>
  resolveProviderBilling(model.pricing, billing, 'deepseek-flash', date ? new Date(date) : null)

describe('DeepSeek official billing defaults', () => {
  // Holidays follow their weekday; the computer's local clock must not change the rate.
  it.each([
    ['2026-11-16T08:59:59+08:00', 0.15],
    ['2026-11-16T09:00:00+08:00', 0.3],
    ['2026-11-16T12:00:00+08:00', 0.15],
    ['2026-11-16T14:00:00+08:00', 0.3],
    ['2026-11-16T18:00:00+08:00', 0.15],
    ['2026-11-16T01:00:00Z', 0.3],
    ['2026-11-15T17:00:00-08:00', 0.3],
    ['2026-11-14T10:00:00+08:00', 0.15],
    ['2026-11-15T10:00:00+08:00', 0.15],
    ['2026-10-01T10:00:00+08:00', 0.3],
    ['2026-02-23T10:00:00+08:00', 0.3],
    ['2026-10-10T10:00:00+08:00', 0.15]
  ])('prices %s at %s USD per million input tokens', (date, expected) => {
    expect(priceAt(date).pricing?.input.perMillionTokens).toBe(expected)
  })

  it('prices cached tokens once and halves all three official token prices', () => {
    const usage = { inputTokens: 2000000, outputTokens: 1000000, inputTokenDetails: { cacheReadTokens: 1000000 } }
    const peak = priceAt('2026-11-16T10:00:00+08:00')
    const offPeak = priceAt('2026-11-16T12:00:00+08:00')
    expect(computeLanguageCost(usage, createAiUsagePricingSnapshot(peak.pricing)!)?.cost).toBeCloseTo(1.506)
    expect(computeLanguageCost(usage, createAiUsagePricingSnapshot(offPeak.pricing)!)?.cost).toBeCloseTo(0.753)
    expect(model.pricing?.input.perMillionTokens).toBe(0.3)
    expect(BillingResolutionSchema.parse(peak.billing)).toMatchObject({
      source: 'deepseek',
      ruleVersion: '2026-11-14-weekdays'
    })
  })

  it('uses the same weekday rules in future years and falls back only when invocation time is unknown', () => {
    expect(priceAt('2030-01-01T10:00:00+08:00').billing).toMatchObject({ reason: 'period', multiplier: 1 })
    expect(priceAt('2030-01-01T20:00:00+08:00').billing).toMatchObject({ reason: 'default', multiplier: 0.5 })
    expect(priceAt('2030-01-05T10:00:00+08:00').billing).toMatchObject({ reason: 'default', multiplier: 0.5 })
    expect(priceAt(null).billing).toMatchObject({ reason: 'peak_fallback', multiplier: 1 })
    expect(priceAt(null).billing?.pricedAt).toBeUndefined()
  })

  it('limits defaults to official models, endpoints and prices, including copied official providers', () => {
    for (const apiModelId of [
      'deepseek-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp'
    ]) {
      expect(
        getDefaultProviderBilling({ ...provider, id: 'copy', presetProviderId: 'deepseek' }, { ...model, apiModelId })
      ).toEqual(billing)
    }
    expect(getDefaultProviderBilling({ ...provider, id: 'relay' }, model)).toBeUndefined()
    expect(getDefaultProviderBilling(provider, { ...model, hasCustomPricing: true })).toBeUndefined()
    expect(getDefaultProviderBilling(provider, { ...model, apiModelId: 'deepseek-chat' })).toBeUndefined()
    for (const baseUrl of [
      'https://relay.test',
      'https://api.deepseek.com.relay.test',
      'http://api.deepseek.com',
      'invalid'
    ]) {
      expect(getDefaultProviderBilling(provider, model, baseUrl)).toBeUndefined()
    }
    expect(getDefaultProviderBilling(provider, model, 'https://api.deepseek.com/anthropic')).toEqual(billing)
    expect(getDefaultProviderBilling(provider, { ...model, endpointTypes: ['anthropic-messages'] })).toEqual(billing)
  })
})
