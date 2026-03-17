import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WebSearchSettingsField } from '../WebSearchSettingsLayout'

describe('WebSearchSettingsField', () => {
  it('does not render a label row when title and meta are omitted', () => {
    render(
      <WebSearchSettingsField>
        <div>content</div>
      </WebSearchSettingsField>
    )

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByText(/^API Key$/)).not.toBeInTheDocument()
  })

  it('renders the label row when a title is provided', () => {
    render(
      <WebSearchSettingsField title="API Key">
        <div>content</div>
      </WebSearchSettingsField>
    )

    expect(screen.getByText('API Key')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
