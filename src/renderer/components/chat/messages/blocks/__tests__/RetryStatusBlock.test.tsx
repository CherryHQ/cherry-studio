import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, values: { model: string; attempt: number }) => `${values.model}:${values.attempt}`
  })
}))

import RetryStatusBlock from '../RetryStatusBlock'

describe('RetryStatusBlock', () => {
  it('shows the active retry and its diagnostic reason', () => {
    render(
      <RetryStatusBlock
        data={{ state: 'retrying', modelId: 'anthropic::claude', attempt: 2, reason: 'http 429: rate limited' }}
      />
    )

    expect(screen.getByText('anthropic::claude:2').parentElement).toHaveAttribute('title', 'http 429: rate limited')
  })

  it('clears itself after the retry operation settles', () => {
    const { container } = render(<RetryStatusBlock data={{ state: 'settled' }} />)

    expect(container).toBeEmptyDOMElement()
  })
})
