import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

import ImagePayloadReducedBlock from '../ImagePayloadReducedBlock'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => {
      const template = (enUS as Record<string, string>)[key] ?? key
      if (!values) return template
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        template
      )
    }
  })
}))

describe('ImagePayloadReducedBlock', () => {
  it('renders localized notice when earlier images were compressed', () => {
    render(<ImagePayloadReducedBlock data={{ reducedCount: 3, omittedCount: 0 }} />)
    expect(screen.getByText('Images re-encoded to fit request limit (3)')).toBeInTheDocument()
  })

  it('renders localized notice when earlier images were omitted', () => {
    render(<ImagePayloadReducedBlock data={{ reducedCount: 0, omittedCount: 2 }} />)
    expect(screen.getByText('Images omitted to fit request limit (2)')).toBeInTheDocument()
  })

  it('renders combined localized notice when earlier images were both compressed and omitted', () => {
    render(<ImagePayloadReducedBlock data={{ reducedCount: 2, omittedCount: 1 }} />)
    expect(screen.getByText('Images adjusted to fit request limit (2 re-encoded, 1 omitted)')).toBeInTheDocument()
  })

  it('renders nothing when counts are zero or data is absent', () => {
    const emptyCounts = render(<ImagePayloadReducedBlock data={{ reducedCount: 0, omittedCount: 0 }} />)
    expect(emptyCounts.container).toBeEmptyDOMElement()

    const missingData = render(<ImagePayloadReducedBlock />)
    expect(missingData.container).toBeEmptyDOMElement()
  })
})
