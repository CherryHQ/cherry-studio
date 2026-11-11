// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
})
