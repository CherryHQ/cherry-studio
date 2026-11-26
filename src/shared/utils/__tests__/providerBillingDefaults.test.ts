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

describe('CherryIN production weekday billing defaults', () => {
  const cherryInProvider = { ...provider, id: 'cherryin', endpointConfigs: undefined }
  const cherryInModel = { ...model, apiModelId: 'agent/deepseek-v4-flash', pricing: undefined }
  const baseUrl = 'https://open.cherryin.net/v1'

  it.each([
    ['agent/deepseek-v4-flash', 0.3, 1.2, 0.006],
    ['agent/deepseek-v4-pro', 1.35, 4.05, 0.045],
    ['deepseek-v4.1-flash', 0.3, 1.2, 0.006],
    ['deepseek/deepseek-flash', 0.3, 1.2, 0.006],
    ['deepseek/deepseek-v4-flash', 0.3, 1.2, 0.006],
    ['deepseek/deepseek-v4-flash-vision-exp', 0.3, 1.2, 0.006],
    ['deepseek/deepseek-v4-pro', 1.35, 4.05, 0.045],
    ['deepseek/deepseek-v4.1-flash-1017', 0.3, 1.2, 0.006]
  ])('prices %s on weekdays and weekends using the advertised schedule', (apiModelId, input, output, cacheRead) => {
    const billing = getDefaultProviderBilling(cherryInProvider, { ...cherryInModel, apiModelId }, baseUrl)
    for (const [date, multiplier] of [
      ['2026-11-16T01:00:00Z', 1],
      ['2026-11-16T04:00:00Z', 0.5],
      ['2026-11-16T06:00:00Z', 1],
      ['2026-11-16T10:00:00Z', 0.5],
      ['2026-11-14T01:00:00Z', 0.5]
    ] as const) {
      expect(resolveProviderBilling(undefined, billing, apiModelId, new Date(date)).pricing).toMatchObject({
        input: { currency: 'USD', perMillionTokens: input * multiplier },
        output: { currency: 'USD', perMillionTokens: output * multiplier },
        cacheRead: { currency: 'USD', perMillionTokens: cacheRead * multiplier }
      })
    }
  })

  it('leaves custom prices, nonproduction relays and the free variant alone', () => {
    expect(
      getDefaultProviderBilling(cherryInProvider, { ...cherryInModel, hasCustomPricing: true }, baseUrl)
    ).toBeUndefined()
    expect(getDefaultProviderBilling(cherryInProvider, cherryInModel, 'https://open.cherryin.dev')).toBeUndefined()
    expect(
      getDefaultProviderBilling(
        cherryInProvider,
        { ...cherryInModel, apiModelId: 'deepseek/deepseek-v3.2(free)' },
        baseUrl
      )
    ).toBeUndefined()
  })

  it('uses the published cache-duration rates without applying peak or off-peak discounts', () => {
    const apiModelId = 'moonshotai/kimi-k3.1-pro'
    const durationModel = { ...cherryInModel, apiModelId }
    const billing = getDefaultProviderBilling(cherryInProvider, durationModel, baseUrl)

    for (const date of ['2026-11-16T01:00:00Z', '2026-11-16T04:00:00Z']) {
      const resolved = resolveProviderBilling(undefined, billing, apiModelId, new Date(date))
      expect(resolved.billing).toMatchObject({
        multiplier: 1,
        reason: 'default',
        ruleVersion: '2026-11-26-cache-duration'
      })
      expect(resolved.pricing?.cacheWrite?.perMillionTokens).toBe(2)
    }
    expect(
      getDefaultProviderBilling(cherryInProvider, { ...durationModel, hasCustomPricing: true }, baseUrl)
    ).toBeUndefined()
    expect(getDefaultProviderBilling(cherryInProvider, durationModel, 'https://open.cherryin.dev')).toBeUndefined()
  })
})
