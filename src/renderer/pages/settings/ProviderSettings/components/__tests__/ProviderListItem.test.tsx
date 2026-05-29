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

  it('uses one font-weight step between idle and selected labels', () => {
    const { rerender } = render(
      <ProviderListItem provider={provider} selected={false} dragging={false} onClick={vi.fn()} />
    )

    expect(screen.getByText('硅基流动')).toHaveClass('font-normal')

    rerender(<ProviderListItem provider={provider} selected dragging={false} onClick={vi.fn()} />)

    expect(screen.getByText('硅基流动')).toHaveClass('font-medium')
  })

  it('renders provider logos at 22px in the list', () => {
    render(<ProviderListItem provider={provider} selected={false} dragging={false} onClick={vi.fn()} />)

    expect(providerAvatarMock).toHaveBeenCalledWith(expect.objectContaining({ size: 22 }))
  })
})
