import { describe, expect, it } from 'vitest'

import { ProviderBillingSchema, type ProviderBilling } from '@shared/data/types/providerBilling'

import { resolveProviderBilling } from '../providerBilling'
import { computeLanguageCost, createAiUsagePricingSnapshot } from '../usagePricing'

const pricing = {
  input: { perMillionTokens: 4, currency: 'USD' as const },
  output: { perMillionTokens: 12, currency: 'USD' as const },
  cacheRead: { perMillionTokens: 1, currency: 'USD' as const },
  inputTokenTiers: [
    {
      minInputTokens: 200000,
      input: { perMillionTokens: 8, currency: 'USD' as const },
      output: { perMillionTokens: 24, currency: 'USD' as const }
    }
  ]
}
const billing: ProviderBilling = {
  defaultMultiplier: 0.8,
  scheduleEnabled: true,
  timeZone: 'Asia/Shanghai',
  periods: [{ id: 'night', name: 'Night', start: '23:00', end: '08:00', mode: 'multiplier', multiplier: 0.5 }]
}
const at = (time: string) => new Date(`2026-10-11T${time}:00+08:00`)

describe('provider billing', () => {
  it.each([
    ['22:59', 3.2],
    ['23:00', 2],
    ['00:00', 2],
    ['07:59', 2],
    ['08:00', 3.2]
  ])('prices %s in the configured time zone without stacking multipliers', (time, expected) => {
    const result = resolveProviderBilling(pricing, billing, 'a', at(time))
    expect(result.pricing?.input.perMillionTokens).toBe(expected)
    expect(pricing.input.perMillionTokens).toBe(4)
  })

  it('applies explicit model prices and falls back for other models', () => {
    const config: ProviderBilling = {
      ...billing,
      periods: [
        {
          id: 'all',
          name: 'All',
          start: '00:00',
          end: '24:00',
          mode: 'prices',
          models: [
            {
              modelId: 'a',
              pricing: {
                input: { perMillionTokens: 6, currency: 'CNY' },
                output: { perMillionTokens: 18, currency: 'CNY' }
              }
            }
          ]
        }
      ]
    }
    expect(resolveProviderBilling(pricing, config, 'a', at('12:00')).pricing?.input).toEqual({
      perMillionTokens: 6,
      currency: 'CNY'
    })
    const other = resolveProviderBilling(pricing, config, 'b', at('12:00'))
    expect(other.pricing?.input.perMillionTokens).toBe(3.2)
    expect(other.billing?.reason).toBe('model_fallback')
  })

  it('switches adjacent periods exactly at midnight and treats 24:00 as the exclusive day end', () => {
    const config: ProviderBilling = {
      ...billing,
      timeZone: '+08:00',
      periods: [
        { ...billing.periods[0], id: 'late', start: '22:00', end: '24:00', mode: 'multiplier', multiplier: 0 },
        { ...billing.periods[0], id: 'early', start: '00:00', end: '06:00', mode: 'multiplier', multiplier: 0.5 }
      ]
    }
    for (const [instant, periodId, rate] of [
      ['2026-10-11T23:59:59.999+08:00', 'late', 0],
      ['2026-10-12T00:00:00.000+08:00', 'early', 2],
      ['2026-10-12T06:00:00.000+08:00', undefined, 3.2]
    ] as const) {
      const result = resolveProviderBilling(pricing, config, 'a', new Date(instant))
      expect(result.billing?.periodId).toBe(periodId)
      expect(result.pricing?.input.perMillionTokens).toBe(rate)
    }
    expect(
      resolveProviderBilling(
        pricing,
        { ...config, periods: [{ ...config.periods[0], start: '00:00' }] },
        'a',
        at('00:00')
      ).pricing?.input.perMillionTokens
    ).toBe(0)
  })

  it('retains unknown prices at zero multiplier and skips schedules when disabled', () => {
    const result = resolveProviderBilling(
      { input: { perMillionTokens: null, currency: 'USD' }, output: pricing.output },
      { ...billing, defaultMultiplier: 0, scheduleEnabled: false },
      'a',
      at('23:00')
    )
    expect(result.pricing?.input.perMillionTokens).toBeNull()
    expect(result.pricing?.output.perMillionTokens).toBe(0)
    expect(resolveProviderBilling(pricing, billing, 'a', null).pricing?.input.perMillionTokens).toBe(3.2)
  })

  it.each([
    {
      label: 'default-rate gaps',
      defaultMultiplier: 0.8,
      start: '23:00',
      end: '08:00',
      multiplier: 0.5,
      expected: 0.8,
      periodId: undefined
    },
    {
      label: 'a scheduled peak',
      defaultMultiplier: 0.8,
      start: '23:00',
      end: '08:00',
      multiplier: 2,
      expected: 2,
      periodId: 'night'
    },
    {
      label: 'an all-day free period',
      defaultMultiplier: 10,
      start: '00:00',
      end: '24:00',
      multiplier: 0,
      expected: 0,
      periodId: 'night'
    }
  ])(
    'estimates unknown-start usage at the peak rate for $label',
    ({ defaultMultiplier, start, end, multiplier, expected, periodId }) => {
      const result = resolveProviderBilling(
        pricing,
        {
          ...billing,
          defaultMultiplier,
          periods: [{ ...billing.periods[0], mode: 'multiplier', start, end, multiplier }]
        },
        'a',
        null
      )
      expect(result.billing).toEqual({
        mode: 'multiplier',
        multiplier: expected,
        timeZone: billing.timeZone,
        reason: 'peak_fallback',
        ...(periodId ? { periodId, periodName: 'Night' } : {})
      })
      expect(result.pricing?.input).toEqual({ perMillionTokens: 4 * expected, currency: 'USD' })
      expect(result.pricing?.cacheRead?.perMillionTokens).toBe(expected)
      expect(result.pricing?.inputTokenTiers?.[0]).toMatchObject({
        minInputTokens: 200000,
        input: { perMillionTokens: 8 * expected }
      })
      expect(pricing.input.perMillionTokens).toBe(4)
    }
  )

  it('ignores an inactive default rate when adjacent overnight periods cover the day', () => {
    const result = resolveProviderBilling(
      pricing,
      {
        ...billing,
        defaultMultiplier: 10,
        periods: [
          { ...billing.periods[0], mode: 'multiplier', start: '22:00', end: '06:00', multiplier: 0.25 },
          { id: 'day', name: 'Day', mode: 'multiplier', start: '06:00', end: '22:00', multiplier: 0.5 }
        ]
      },
      'a',
      null
    )
    expect(result.pricing?.input.perMillionTokens).toBe(2)
    expect(result.billing).toMatchObject({ multiplier: 0.5, periodId: 'day', reason: 'peak_fallback' })
  })

  it('uses the fixed rate without an active schedule and never invents unknown base prices', () => {
    for (const config of [
      { ...billing, scheduleEnabled: false },
      { ...billing, periods: [] }
    ]) {
      const result = resolveProviderBilling(pricing, config, 'a', null)
      expect(result.pricing?.input.perMillionTokens).toBe(3.2)
      expect(result.billing?.reason).toBe('default')
    }
    expect(resolveProviderBilling(null, billing, 'a', null).pricing).toBeNull()
    expect(
      resolveProviderBilling({ ...pricing, input: { perMillionTokens: null, currency: 'USD' } }, billing, 'a', null)
        .pricing?.input.perMillionTokens
    ).toBeNull()
  })

  it('matches a fixed UTC offset with minute precision without daylight-saving changes', () => {
    const config = ProviderBillingSchema.parse({ ...billing, timeZone: '+05:45' })
    for (const month of ['01', '07']) {
      const before = resolveProviderBilling(pricing, config, 'a', new Date(`2026-${month}-11T17:14:00Z`))
      const boundary = resolveProviderBilling(pricing, config, 'a', new Date(`2026-${month}-11T17:15:00Z`))
      expect(before.pricing?.input.perMillionTokens).toBe(3.2)
      expect(boundary.pricing?.input.perMillionTokens).toBe(2)
      expect(boundary.billing?.timeZone).toBe('+05:45')
    }
  })

  it('prices cached input once and applies the whole-call token tier', () => {
    const result = resolveProviderBilling(pricing, billing, 'a', at('23:00'))
    const snapshot = createAiUsagePricingSnapshot(result.pricing)!
    expect(
      computeLanguageCost(
        { inputTokens: 100000, outputTokens: 10000, inputTokenDetails: { cacheReadTokens: 40000 } },
        snapshot
      )?.cost
    ).toBeCloseTo(0.2)
    expect(
      computeLanguageCost(
        { inputTokens: 200000, outputTokens: 10000, inputTokenDetails: { cacheReadTokens: 40000 } },
        snapshot
      )?.cost
    ).toBeCloseTo(0.92)
    expect(snapshot.inputTokenTiers?.[0].minInputTokens).toBe(200000)
  })

  it('matches both repeated local hours at the end of daylight saving time', () => {
    const config: ProviderBilling = {
      ...billing,
      timeZone: 'America/New_York',
      periods: [{ ...billing.periods[0], start: '01:00', end: '02:00' }]
    }
    for (const time of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) {
      expect(resolveProviderBilling(pricing, config, 'a', new Date(time)).pricing?.input.perMillionTokens).toBe(2)
    }
  })

  it('rejects ambiguous times, invalid zones and overlapping overnight periods', () => {
    for (const patch of [
      { timeZone: 'invalid/zone' },
      { timeZone: '+24:00' },
      { timeZone: '+08:60' },
      { defaultMultiplier: -1 },
      { defaultMultiplier: Infinity },
      { periods: [{ ...billing.periods[0], start: '24:00' }] },
      { periods: [{ ...billing.periods[0], end: '23:00' }] },
      { periods: [billing.periods[0], { ...billing.periods[0], id: 'other', start: '07:00', end: '10:00' }] }
    ])
      expect(ProviderBillingSchema.safeParse({ ...billing, ...patch }).success).toBe(false)
    expect(
      ProviderBillingSchema.safeParse({
        ...billing,
        periods: [billing.periods[0], { ...billing.periods[0], id: 'other', start: '08:00', end: '23:00' }]
      }).success
    ).toBe(true)
  })
})
