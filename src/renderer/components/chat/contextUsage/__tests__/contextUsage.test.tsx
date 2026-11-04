import { act, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import de from '@renderer/i18n/locales/de-de.json'
import en from '@renderer/i18n/locales/en-us.json'

import { ContextUsageMeter, ContextUsageSummary } from '..'

describe('context usage presentation', () => {
  it('formats token totals using the interface language and updates when it changes', async () => {
    const i18n = createInstance()
    await i18n.init({
      lng: 'en-US',
      keySeparator: false,
      resources: { 'en-US': { translation: en }, 'de-DE': { translation: de } }
    })
    render(
      <I18nextProvider i18n={i18n}>
        <ContextUsageSummary
          title="Context usage"
          emptyLabel="None"
          data={{ usedTokens: 1234, maxTokens: 10000, percentage: 12, modelName: 'Model' }}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('1,234 / 10,000 (12%)')).toBeInTheDocument()

    await act(() => i18n.changeLanguage('de-DE'))
    expect(screen.getByText('1.234 / 10.000 (12%)')).toBeInTheDocument()

    await act(() => i18n.changeLanguage('en-US'))
    expect(screen.getByText('1,234 / 10,000 (12%)')).toBeInTheDocument()
  })

  it('uses the same normalized percentage for the summary and accessible meter', () => {
    render(
      <>
        <ContextUsageSummary
          title="Context usage"
          emptyLabel="None"
          data={{ usedTokens: 42, maxTokens: 100, percentage: 42.4, modelName: 'Model' }}
        />
        <ContextUsageMeter label="Context usage" percentage={42.4} isBusy />
      </>
    )

    expect(screen.getByText('42 / 100 (42%)')).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: 'Context usage 42%' })
    expect(meter).toHaveAttribute('tabindex', '0')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
    expect(meter).toHaveAttribute('aria-valuenow', '42')
    expect(meter).toHaveAttribute('aria-busy', 'true')
  })
})
