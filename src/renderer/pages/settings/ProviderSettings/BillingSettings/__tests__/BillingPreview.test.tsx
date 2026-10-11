import { cleanup, render, screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ModelSchema } from '@shared/data/types/model'
import type { ProviderBilling } from '@shared/data/types/providerBilling'

import { BillingPreview } from '../BillingPreview'

vi.unmock('@cherrystudio/ui')

const model = ModelSchema.parse({
  id: 'group::model',
  providerId: 'group',
  name: 'Model',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  pricing: {
    input: { perMillionTokens: 2, currency: 'USD' },
    output: { perMillionTokens: 6, currency: 'USD' },
    cacheRead: { perMillionTokens: 0.4, currency: 'USD' },
    inputTokenTiers: [
      {
        minInputTokens: 200000,
        input: { perMillionTokens: 4, currency: 'USD' },
        output: { perMillionTokens: 12, currency: 'USD' }
      }
    ]
  }
})
const billing: ProviderBilling = {
  defaultMultiplier: 2,
  scheduleEnabled: true,
  timeZone: '+08:00',
  periods: [{ id: 'night', name: '22:00–06:00', start: '22:00', end: '06:00', mode: 'multiplier', multiplier: 0.5 }]
}

describe('daily billing preview', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it.each(['+08:00', '+05:45', '-03:30', '+00:00'])(
    'shows exact daily prices at %s including tiers and cache fallback',
    (timeZone) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-11T23:59:59.999Z'))
      render(<BillingPreview models={[model]} billing={{ ...billing, timeZone }} />)
      const rows = screen
        .getAllByRole('row')
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((cell) => cell.textContent)
        )
      expect(rows.map((row) => row.slice(1))).toEqual([
        ['4', '12', '0.8', '4'],
        ['8', '24', '8', '8'],
        ['1', '3', '0.2', '1'],
        ['2', '6', '2', '2']
      ])
      expect(rows.map((row) => row[0].slice(0, 11))).toEqual([
        '06:00–22:00',
        '06:00–22:00',
        '22:00–06:00',
        '22:00–06:00'
      ])
    }
  )

  it('keeps adjacent midnight periods distinct and displays zero without treating missing rates as free', () => {
    const unpricedOutput = {
      ...model,
      pricing: { input: model.pricing!.input, output: { perMillionTokens: null, currency: 'USD' as const } }
    }
    render(
      <BillingPreview
        models={[unpricedOutput]}
        billing={{
          ...billing,
          periods: [
            { ...billing.periods[0], id: 'late', start: '22:00', end: '24:00', mode: 'multiplier', multiplier: 0 },
            { ...billing.periods[0], id: 'early', start: '00:00', end: '06:00', mode: 'multiplier', multiplier: 0.5 }
          ]
        }}
      />
    )
    expect(screen.getByRole('row', { name: '00:00–06:00 1 Unable to estimate 1 1' })).toBeVisible()
    expect(screen.getByRole('row', { name: '22:00–24:00 0 Unable to estimate 0 0' })).toBeVisible()
  })

  it('selects an available model when models load or the selected model is removed', () => {
    const config = { ...billing, scheduleEnabled: false }
    const loaded = { ...model, pricing: { input: model.pricing!.input, output: model.pricing!.output } }
    const { rerender } = render(<BillingPreview models={[]} billing={config} />)
    rerender(<BillingPreview models={[loaded]} billing={config} />)
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Model')
    expect(screen.getByRole('row', { name: '00:00–24:00 4 12 4 4' })).toBeVisible()
    rerender(<BillingPreview models={[{ ...loaded, id: 'group::new', name: 'New model' }]} billing={config} />)
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('New model')
    expect(screen.getByRole('row', { name: '00:00–24:00 4 12 4 4' })).toBeVisible()
  })
})
