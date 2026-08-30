import {
  buildModelPricingPatch,
  buildPricingTimeline,
  buildVisualCronExpressions,
  createModelPricingDraft,
  createPricingTimelineAnchor,
  findModelPricingRuleConflicts,
  parseModelPricingDraft,
  parseVisualCronExpressions
} from '@renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/modelPricing'
import { describe, expect, it } from 'vitest'

const providerPricing = {
  input: { perMillionTokens: 1, currency: 'USD' as const },
  output: { perMillionTokens: 2, currency: 'USD' as const },
  rules: [
    {
      when: { time: { timezone: 'UTC', cron: ['* 1-3 * * 1-5'] } },
      pricing: { input: { perMillionTokens: 0.5, currency: 'USD' as const } }
    }
  ]
}

describe('model pricing draft contract', () => {
  it('does not establish user ownership when the effective provider policy was not changed', () => {
    expect(buildModelPricingPatch(providerPricing, createModelPricingDraft(providerPricing))).toBeUndefined()
  })

  it('returns the explicit restore state independently of draft contents', () => {
    expect(buildModelPricingPatch(providerPricing, createModelPricingDraft(providerPricing), true)).toBeNull()
  })

  it('rejects rules without a condition or price override', () => {
    const draft = createModelPricingDraft(providerPricing)
    draft.rules[0] = {
      ...draft.rules[0],
      cron: '',
      startsAt: '',
      endsAt: '',
      minInputTokens: '',
      pricing: { input: '', output: '', cacheRead: '', cacheWrite: '' }
    }
    const result = parseModelPricingDraft(draft)
    expect(result.pricing).toBeUndefined()
    expect(result.firstInvalidRuleIndex).toBe(0)
  })

  it('compiles visual ranges into half-open five-part cron expressions, including midnight carry', () => {
    expect(buildVisualCronExpressions([1, 5], [{ start: '09:30', end: '11:15' }])).toEqual([
      '30-59 9 * * 1,5',
      '* 10 * * 1,5',
      '0-14 11 * * 1,5'
    ])
    expect(buildVisualCronExpressions([5], [{ start: '23:00', end: '01:00' }])).toEqual(['* 23 * * 5', '* 0 * * 6'])
  })

  it('only opens Cron expressions in the visual editor when their weekly minute grid is lossless', () => {
    expect(parseVisualCronExpressions(['* 1-3 * * 1-5', '* 6-9 * * 1-5'])).toEqual({
      weekdays: [1, 2, 3, 4, 5],
      ranges: [
        { start: '01:00', end: '04:00' },
        { start: '06:00', end: '10:00' }
      ]
    })
    expect(parseVisualCronExpressions(['*/15 * * * *'])).toBeNull()
  })

  it('projects real 23 and 25 hour days across daylight-saving transitions', () => {
    const spring = buildPricingTimeline(providerPricing, {
      week: new Date('2026-03-08T12:00:00.000Z'),
      displayTimezone: 'America/New_York',
      inputTokens: 0,
      metric: 'input'
    })
    const fall = buildPricingTimeline(providerPricing, {
      week: new Date('2026-11-01T12:00:00.000Z'),
      displayTimezone: 'America/New_York',
      inputTokens: 0,
      metric: 'input'
    })

    expect(spring.find((day) => day.date === '2026-03-08')?.durationMinutes).toBe(23 * 60)
    expect(fall.find((day) => day.date === '2026-11-01')?.durationMinutes).toBe(25 * 60)
  })

  it.each(['Pacific/Kiritimati', 'Etc/GMT+12'])('keeps a date jump on the selected day in %s', (timezone) => {
    const anchor = createPricingTimelineAnchor('2026-08-30', timezone)
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(anchor)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

    expect(`${values.year}-${values.month}-${values.day}`).toBe('2026-08-30')
  })

  it('warns only when identical conditions override a shared field', () => {
    expect(
      findModelPricingRuleConflicts({
        ...providerPricing,
        rules: [providerPricing.rules[0], providerPricing.rules[0]]
      })
    ).toEqual([[0, 1]])
  })
})
