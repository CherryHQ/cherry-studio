import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ProviderField from '../ProviderField'

describe('ProviderField', () => {
  it('renders field titles with semibold weight by default', () => {
    render(
      <ProviderField title="API Key">
        <input aria-label="api-key" />
      </ProviderField>
    )

    expect(screen.getByText('API Key')).toHaveClass('font-semibold')
  })
})
