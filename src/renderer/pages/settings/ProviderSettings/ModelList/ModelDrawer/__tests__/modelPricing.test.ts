import { buildModelPricingFromDraft } from '@renderer/pages/settings/ProviderSettings/ModelList/ModelDrawer/modelPricing'
import { describe, expect, it } from 'vitest'

describe('buildModelPricingFromDraft', () => {
  it('does not create a manual override when catalog pricing was not changed', () => {
    const result = buildModelPricingFromDraft(
      {
        input: { perMillionTokens: 1, currency: 'USD' },
        output: { perMillionTokens: 2, currency: 'USD' },
        scheduled: {
          rules: [
            {
              schedule: { kind: 'weekly', timezone: 'UTC', daysOfWeek: ['monday'] },
              pricing: { input: { perMillionTokens: 0.5, currency: 'USD' } }
            }
          ]
        }
      },
      {
        tiers: [
          {
            minInputTokens: '0',
            inputPrice: '1',
            outputPrice: '2',
            cacheReadPrice: '',
            cacheWritePrice: ''
          }
        ]
      },
      '$'
    )

    expect(result.pricing).toBeUndefined()
  })

  it('removes provider schedules when the user takes ownership of model pricing', () => {
    const result = buildModelPricingFromDraft(
      {
        input: { perMillionTokens: 1, currency: 'USD' },
        output: { perMillionTokens: 2, currency: 'USD' },
        scheduled: {
          default: { input: { perMillionTokens: 0.5, currency: 'USD' } },
          rules: [
            {
              schedule: {
                kind: 'weekly',
                timezone: 'UTC',
                daysOfWeek: ['monday'],
                startTime: '01:00',
                endTime: '04:00'
              },
              pricing: { input: { perMillionTokens: 1, currency: 'USD' } }
            }
          ]
        }
      },
      {
        tiers: [
          {
            minInputTokens: '0',
            inputPrice: '3',
            outputPrice: '4',
            cacheReadPrice: '',
            cacheWritePrice: ''
          }
        ]
      },
      '$'
    )

    expect(result.pricing).toMatchObject({
      input: { perMillionTokens: 3, currency: 'USD' },
      output: { perMillionTokens: 4, currency: 'USD' }
    })
    expect(result.pricing?.scheduled).toBeUndefined()
  })
})
