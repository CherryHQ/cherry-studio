import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ContextUsageMeter, ContextUsageSummary } from '..'

describe('context usage presentation', () => {
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
