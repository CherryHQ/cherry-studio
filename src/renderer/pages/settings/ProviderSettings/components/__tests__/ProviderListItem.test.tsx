// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProviderListItem from '../ProviderListItem'

vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: () => <span data-testid="provider-avatar" />
}))

afterEach(() => {
  cleanup()
})

describe('ProviderListItem', () => {
  const provider = { id: 'silicon-flow', name: '硅基流动' } as any

  it('renders a drag handle before the provider logo', () => {
    render(<ProviderListItem provider={provider} selected={false} dragging={false} onClick={vi.fn()} />)

    expect(screen.getByTestId('provider-list-drag-handle-silicon-flow')).toBeInTheDocument()
  })

  it('shows an enabled-state dot when provider.isEnabled is true', () => {
    const { container } = render(
      <ProviderListItem
        provider={{ ...provider, isEnabled: true }}
        selected={false}
        dragging={false}
        onClick={vi.fn()}
      />
    )

    expect(container.querySelector('span[aria-hidden].bg-green-500')).toBeInTheDocument()
  })

  it('wraps the row action with renderMenuButton when provided', () => {
    render(
      <ProviderListItem
        provider={{ ...provider, isEnabled: false }}
        selected={false}
        dragging={false}
        onClick={vi.fn()}
        onOpenMenu={vi.fn()}
        renderMenuButton={(button) => <span data-testid="provider-list-menu-anchor">{button}</span>}
      />
    )

    expect(screen.getByTestId('provider-list-menu-anchor')).toContainElement(
      screen.getByTestId('provider-list-menu-silicon-flow')
    )
  })

  it('omits the enabled-state dot when provider.isEnabled is false', () => {
    const { container } = render(
      <ProviderListItem
        provider={{ ...provider, isEnabled: false }}
        selected={false}
        dragging={false}
        onClick={vi.fn()}
      />
    )

    expect(container.querySelector('span[aria-hidden].bg-green-500')).not.toBeInTheDocument()
  })
})
