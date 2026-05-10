import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import WebSearchProviderHeader from '../components/WebSearchProviderHeader'

vi.mock('../components/WebSearchProviderLogo', () => ({
  default: ({ className }: { className?: string }) => <div aria-label="provider logo" className={className} />
}))

describe('WebSearchProviderHeader', () => {
  it('renders provider identity and caller-provided action', () => {
    render(
      <WebSearchProviderHeader
        providerId="tavily"
        providerName="Tavily"
        description="Search optimized for LLMs."
        action={<button type="button">Set as default</button>}
      />
    )

    expect(screen.getByText('Tavily')).toBeInTheDocument()
    expect(screen.getByText('Search optimized for LLMs.')).toBeInTheDocument()
    expect(screen.getByLabelText('provider logo')).toHaveClass('size-9')
    expect(screen.getByRole('button', { name: 'Set as default' })).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
