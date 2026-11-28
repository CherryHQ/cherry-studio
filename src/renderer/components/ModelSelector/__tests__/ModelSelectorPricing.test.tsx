import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { ModelSelectorPricing } from '../ModelSelectorPricing'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, values: Record<string, unknown> = {}) =>
      Object.entries(values).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        en[key as keyof typeof en] ?? key
      )
  })
}))

const model = {
  id: 'provider::api-model',
  apiModelId: 'api-model',
  name: 'Test model',
  pricing: { input: { perMillionTokens: 2, currency: 'USD' }, output: { perMillionTokens: 6, currency: 'USD' } }
} as Model
const referenceTime = new Date('2026-11-22T01:00:00Z')
const show = (value: Model, provider?: Provider) =>
  render(<ModelSelectorPricing model={value} provider={provider} referenceTime={referenceTime} />)

describe('ModelSelectorPricing', () => {
  afterEach(() => vi.restoreAllMocks())

  // Catches zero becoming unknown, tiny rates becoming free, and absent cache prices inheriting input.
  it('distinguishes zero, tiny positive and unavailable rates while retaining individual currencies', () => {
    show({
      ...model,
      hasCustomPricing: true,
      pricing: {
        input: { perMillionTokens: 0, currency: 'USD' },
        output: { perMillionTokens: 0.0000000000003, currency: 'CNY' },
        cacheWrite: { perMillionTokens: -1, currency: 'USD' }
      }
    })
    const section = screen.getByRole('region', { name: 'Reference prices' })
    expect(within(section).getByText('USD 0')).toBeInTheDocument()
    expect(within(section).getByText('CNY 0.0000000000003')).toBeInTheDocument()
    expect(within(section).getAllByText('Unavailable')).toHaveLength(2)
    expect(within(section).getByText(/Custom model rates/)).toBeInTheDocument()
    expect(within(section).getByText(/Provider billing not applied/)).toBeInTheDocument()
  })

  // Catches schedules being ignored or applied to the wrong model, and accidental configuration mutation.
  it('resolves the API identity through existing provider billing without mutating stored rates', () => {
    const original = structuredClone(model)
    const provider = {
      settings: {
        billing: {
          defaultMultiplier: 0.5,
          scheduleEnabled: true,
          timeZone: 'UTC',
          periods: [
            {
              id: 'night',
              name: 'Night',
              start: '00:00',
              end: '02:00',
              mode: 'prices',
              models: [
                {
                  modelId: 'api-model',
                  pricing: {
                    input: { perMillionTokens: 8, currency: 'CNY' },
                    output: { perMillionTokens: 12, currency: 'CNY' }
                  }
                }
              ]
            }
          ]
        }
      }
    } as Provider
    show(model, provider)
    expect(screen.getByText('CNY 8')).toBeInTheDocument()
    expect(screen.getByText('CNY 12')).toBeInTheDocument()
    expect(screen.getByText(/Provider billing as of/)).toBeInTheDocument()
    expect(screen.queryByText(/Provider billing not applied/)).not.toBeInTheDocument()
    expect(model).toEqual(original)
  })

  // Catches flattening long-context rates or mislabeling pixel/minute charges as token rates.
  it('retains tier boundaries and non-token units without inventing unspecified currency', () => {
    show({
      ...model,
      pricing: {
        input: { perMillionTokens: null },
        output: { perMillionTokens: Number.NaN },
        perImage: { price: 0.03, unit: 'pixel' },
        perMinute: { price: 0.4 },
        inputTokenTiers: [
          {
            minInputTokens: 200001,
            input: { perMillionTokens: 7 },
            output: { perMillionTokens: 19 },
            cacheRead: { perMillionTokens: 1 }
          }
        ]
      }
    })
    expect(screen.getByText('From 200,001 input tokens (inclusive)')).toBeInTheDocument()
    expect(screen.getByText('USD 7')).toBeInTheDocument()
    expect(screen.getByText('USD 19')).toBeInTheDocument()
    expect(screen.getByText('USD 1')).toBeInTheDocument()
    expect(screen.getByText('Per pixel: Currency unspecified 0.03')).toBeInTheDocument()
    expect(screen.getByText('Per minute: Currency unspecified 0.4')).toBeInTheDocument()
  })

  it('does not present a model without metadata as free', () => {
    show({ ...model, pricing: undefined })
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/USD 0/)).not.toBeInTheDocument()
  })
})
