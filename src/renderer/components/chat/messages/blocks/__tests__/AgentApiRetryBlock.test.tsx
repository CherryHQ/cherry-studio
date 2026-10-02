import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import enUs from '../../../../../i18n/locales/en-us.json'

const translations: Record<string, string> = {
  'agent.session.api_retry.history': enUs['agent.session.api_retry.history'],
  'agent.session.api_retry.history_detail': enUs['agent.session.api_retry.history_detail']
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-us', resolvedLanguage: 'en-us' },
    t: (key: string, options?: Record<string, number | string>) => {
      const template = translations[key] ?? key
      if (!options) return template
      return Object.entries(options).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
        template
      )
    }
  })
}))

import AgentApiRetryBlock from '../AgentApiRetryBlock'

const retryData = {
  attempt: 2,
  maxRetries: 5,
  retryDelayMs: 3000,
  errorStatus: 429,
  errorCategory: 'rate_limit',
  startedAt: '2026-01-02T03:04:05.000Z'
}

const formattedStartedAt = new Intl.DateTimeFormat('en-us', { dateStyle: 'medium', timeStyle: 'short' }).format(
  new Date(retryData.startedAt)
)

describe('AgentApiRetryBlock', () => {
  // The tooltip is the only place a user can see WHICH failure happened and WHEN.
  // Regression: it was a template literal of raw values (`${errorCategory} · HTTP ${n} · ${startedAt}`),
  // so a non-English UI showed an English "HTTP" label and a raw ISO timestamp.
  it('surfaces the failure category, HTTP status and a locale-formatted time in the tooltip', () => {
    render(<AgentApiRetryBlock data={retryData} />)

    const expected = translations['agent.session.api_retry.history_detail']
      .replace('{{error}}', 'rate_limit')
      .replace('{{status}}', '429')
      .replace('{{time}}', formattedStartedAt)

    expect(screen.getByTitle(expected)).toBeInTheDocument()
    // A raw ISO string is never the user-facing rendering of a timestamp.
    expect(screen.getByTitle(expected).getAttribute('title')).not.toContain('2026-01-02T03:04:05.000Z')
  })

  it('keeps the attempt summary readable and marks the failure with the semantic warning surface', () => {
    const { container } = render(<AgentApiRetryBlock data={retryData} />)

    expect(container.querySelector('div')).toHaveTextContent(
      translations['agent.session.api_retry.history']
        .replace('{{attempt}}', '2')
        .replace('{{max}}', '5')
        .replace('{{status}}', '429')
    )
    // DESIGN.md §3: feedback surfaces use the paired semantic roles, never a raw palette utility.
    expect(container.firstElementChild).toHaveClass('border-warning-border', 'bg-warning-subtle')
    expect(container.firstElementChild?.className).not.toMatch(/amber-/)
  })

  it('renders a dash rather than a broken tooltip when the provider gave no HTTP status', () => {
    render(<AgentApiRetryBlock data={{ ...retryData, errorStatus: null }} />)

    expect(screen.getByTitle(`API error rate_limit (HTTP —) at ${formattedStartedAt}`)).toBeInTheDocument()
  })
})
