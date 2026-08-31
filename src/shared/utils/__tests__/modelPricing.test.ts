import type { RuntimeModelPricing } from '@shared/data/types/model'
import {
  compileModelPricingPolicy,
  normalizeModelPricing,
  projectModelPricingAt,
  resolveModelPricing
} from '@shared/utils/modelPricing'
import { describe, expect, it } from 'vitest'

const rate = (value: number) => ({ perMillionTokens: value, currency: 'USD' as const })
const basePricing: RuntimeModelPricing = { input: rate(1), output: rate(2), cacheRead: rate(0.1) }

describe('model pricing policy', () => {
  it('applies token and time conditions together, cron alternatives, and later field overrides', () => {
    const policy = compileModelPricingPolicy({
      ...basePricing,
      rules: [
        {
          when: { time: { timezone: 'UTC', cron: ['0 1 * * 1', '0 2 * * 1'] } },
          pricing: { input: rate(3), output: rate(4) }
        },
        {
          when: {
            minInputTokens: 10_000,
            time: {
              timezone: 'UTC',
              cron: ['0 2 * * 1'],
              startsAt: '2026-08-31T00:00:00.000Z',
              endsAt: '2026-09-01T00:00:00.000Z'
            }
          },
          pricing: { output: rate(5) }
        }
      ]
    })

    expect(resolveModelPricing(policy, { at: new Date('2026-08-31T02:00:59.999Z'), inputTokens: 9_999 })).toEqual({
      rates: { input: rate(3), output: rate(4), cacheRead: rate(0.1) },
      appliedRuleIndexes: [0]
    })
    expect(resolveModelPricing(policy, { at: new Date('2026-08-31T02:00:59.999Z'), inputTokens: 10_000 })).toEqual({
      rates: { input: rate(3), output: rate(5), cacheRead: rate(0.1) },
      appliedRuleIndexes: [0, 1]
    })
    expect(resolveModelPricing(policy, { at: new Date('2026-09-07T02:00:00.000Z'), inputTokens: 10_000 })).toEqual({
      rates: { input: rate(3), output: rate(4), cacheRead: rate(0.1) },
      appliedRuleIndexes: [0]
    })
  })

  it('uses half-open absolute boundaries', () => {
    const policy = compileModelPricingPolicy({
      ...basePricing,
      rules: [
        {
          when: {
            time: {
              timezone: 'America/New_York',
              startsAt: '2026-11-01T05:00:00.000Z',
              endsAt: '2026-11-01T07:00:00.000Z'
            }
          },
          pricing: { input: rate(0.5) }
        }
      ]
    })

    expect(
      resolveModelPricing(policy, { at: new Date('2026-11-01T05:00:00.000Z'), inputTokens: 0 }).rates.input
    ).toEqual(rate(0.5))
    expect(
      resolveModelPricing(policy, { at: new Date('2026-11-01T07:00:00.000Z'), inputTokens: 0 }).rates.input
    ).toEqual(rate(1))
  })

  it('normalizes legacy token tiers and projects time-filtered snapshots', () => {
    const legacy: RuntimeModelPricing = {
      ...basePricing,
      inputTokenTiers: [
        { minInputTokens: 1_000, input: rate(10), output: rate(20) },
        { minInputTokens: 2_000, input: rate(11), output: rate(21) }
      ]
    }
    expect(normalizeModelPricing(legacy).rules.map((rule) => rule.when.minInputTokens)).toEqual([1_000, 2_000])

    const projection = projectModelPricingAt(compileModelPricingPolicy(legacy), new Date('2026-08-31T00:00:00.000Z'))
    expect(projection.base.rates.input).toEqual(rate(1))
    expect(projection.tiers.map(({ minInputTokens, resolution }) => [minInputTokens, resolution.rates.input])).toEqual([
      [1_000, rate(10)],
      [2_000, rate(11)]
    ])
  })

  it('evaluates cron in each rule timezone across a DST transition', () => {
    const policy = compileModelPricingPolicy({
      ...basePricing,
      rules: [
        {
          when: { time: { timezone: 'America/New_York', cron: ['30 1 * * 0'] } },
          pricing: { input: rate(7) }
        }
      ]
    })

    expect(
      resolveModelPricing(policy, { at: new Date('2026-11-01T05:30:00.000Z'), inputTokens: 0 }).rates.input
    ).toEqual(rate(7))
    expect(
      resolveModelPricing(policy, { at: new Date('2026-11-01T06:30:00.000Z'), inputTokens: 0 }).rates.input
    ).toEqual(rate(7))
  })
})
