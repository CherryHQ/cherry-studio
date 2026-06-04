// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProviderListItem from '../ProviderListItem'

const providerAvatarMock = vi.fn()

vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: (props: any) => {
    providerAvatarMock(props)
    return <span data-testid="provider-avatar" />
  }
}))

afterEach(() => {
  cleanup()
})

describe('ProviderListItem', () => {
  const provider = { id: 'silicon-flow', name: '硅基流动' } as any

  it('keeps the same medium font weight for idle and selected labels', () => {
    const { rerender } = render(
      <ProviderListItem provider={provider} selected={false} dragging={false} onClick={vi.fn()} />
    )

    expect(screen.getByText('硅基流动')).toHaveClass('font-[weight:500]')
    expect(screen.getByText('硅基流动')).not.toHaveClass('font-normal')

    rerender(<ProviderListItem provider={provider} selected dragging={false} onClick={vi.fn()} />)

    expect(screen.getByText('硅基流动')).toHaveClass('font-[weight:500]')
    expect(screen.getByText('硅基流动')).not.toHaveClass('font-medium')
  })

  it('renders provider logos at 26px in the list', () => {
    render(<ProviderListItem provider={provider} selected={false} dragging={false} onClick={vi.fn()} />)

    expect(providerAvatarMock).toHaveBeenCalledWith(expect.objectContaining({ size: 26 }))
  })

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

  it('reserves a trailing slot when enabled-state dot is shown', () => {
    const { container } = render(
      <ProviderListItem
        provider={{ ...provider, isEnabled: true }}
        selected={false}
        dragging={false}
        onClick={vi.fn()}
      />
    )

    const row = container.querySelector('[data-testid="provider-list-item-silicon-flow"]')

    expect(row?.children).toHaveLength(2)
    expect(row?.lastElementChild).toHaveClass('size-2', 'shrink-0')
  })

  it('reserves a trailing slot when row actions can appear', () => {
    const { container } = render(
      <ProviderListItem
        provider={{ ...provider, isEnabled: false }}
        selected={false}
        dragging={false}
        onClick={vi.fn()}
        onOpenMenu={vi.fn()}
      />
    )

    const row = container.querySelector('[data-testid="provider-list-item-silicon-flow"]')

    expect(row?.children).toHaveLength(2)
    expect(row?.lastElementChild).toHaveClass('size-5', 'shrink-0')
  })

  it('keeps a compact trailing slot for enabled rows even when row actions can appear', () => {
    const { container } = render(
      <ProviderListItem
        provider={{ ...provider, isEnabled: true }}
        selected={false}
        dragging={false}
        onClick={vi.fn()}
        onOpenMenu={vi.fn()}
      />
    )

    const row = container.querySelector('[data-testid="provider-list-item-silicon-flow"]')

    expect(row?.lastElementChild).toHaveClass('size-2', 'shrink-0')
    expect(screen.getByTestId('provider-list-menu-silicon-flow')).toHaveClass('size-5')
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
    expect(screen.getByTestId('provider-list-menu-anchor').parentElement).toHaveClass('size-5', 'shrink-0')
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

  it('does not reserve a trailing slot when there is no dot or row action', () => {
    const { container } = render(
      <ProviderListItem
        provider={{ ...provider, isEnabled: false }}
        selected={false}
        dragging={false}
        onClick={vi.fn()}
      />
    )

    expect(container.querySelector('[data-testid="provider-list-item-silicon-flow"]')?.children).toHaveLength(1)
  })
})
