// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ProviderListItem from '../ProviderListItem'

vi.mock('@renderer/pages/settings/ProviderSettings/components/ProviderAvatar', () => ({
  ProviderAvatar: () => <span data-testid="provider-avatar" />
}))

describe('ProviderListItem', () => {
  const provider = { id: 'silicon-flow', name: '硅基流动' } as any

  it.each(['Enter', ' '])('selects the provider when the row receives %j', (key) => {
    const onClick = vi.fn()
    render(<ProviderListItem provider={provider} selected={false} dragging={false} onClick={onClick} />)

    fireEvent.keyDown(screen.getByRole('button'), { key })

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('opens the row menu without selecting the provider', () => {
    const onClick = vi.fn()
    const onOpenMenu = vi.fn()
    render(
      <ProviderListItem
        provider={provider}
        selected={false}
        dragging={false}
        onClick={onClick}
        onOpenMenu={onOpenMenu}
      />
    )

    fireEvent.click(screen.getByTestId('provider-list-menu-silicon-flow'))

    expect(onOpenMenu).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('passes the menu button through the supplied wrapper', () => {
    render(
      <ProviderListItem
        provider={provider}
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
})
