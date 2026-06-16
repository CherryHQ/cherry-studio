// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Resolve only `openai` to a recognizable stand-in icon; everything else is unknown.
vi.mock('@cherrystudio/ui/icons', () => ({
  resolveProviderIcon: (id: string) =>
    id === 'openai'
      ? ({ style, variant }: { style?: CSSProperties; variant?: string }) => (
          <span data-testid="brand-icon" data-variant={variant} style={style} />
        )
      : undefined
}))

import { ProviderAvatarPrimitive } from '../ProviderAvatar'

afterEach(() => {
  cleanup()
})

describe('ProviderAvatarPrimitive', () => {
  it('renders image logo avatars with object-cover cropping', () => {
    const logo = 'file:///tmp/wide-provider-logo.png'

    render(<ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo={logo} />)

    expect(document.querySelector('img')).toHaveClass('object-cover')
    expect(document.querySelector('img')).toHaveAttribute('src', logo)
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('resolves an `icon:<id>` logo to the built-in brand icon', () => {
    render(<ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo="icon:openai" />)

    expect(screen.getByTestId('brand-icon')).toBeInTheDocument()
    expect(screen.getByTestId('brand-icon')).not.toHaveAttribute('data-variant')
    // The raw reference must not leak through as an image source.
    expect(document.querySelector('img')).toBeNull()
  })

  it('sizes built-in icons relative to the avatar container', () => {
    render(
      <ProviderAvatarPrimitive
        providerId="custom"
        providerName="Custom"
        logo="icon:openai"
        style={{ width: '52px', height: '52px' }}
      />
    )

    expect(screen.getByTestId('brand-icon')).toHaveStyle({ width: '70%', height: '70%' })
  })

  it('falls back to the name initial when an `icon:<id>` reference is unknown', () => {
    render(<ProviderAvatarPrimitive providerId="custom" providerName="Zeta" logo="icon:does-not-exist" />)

    expect(screen.queryByTestId('brand-icon')).not.toBeInTheDocument()
    expect(screen.getByText('Z')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('switches from an uploaded image to a built-in icon without leaving an image node behind', () => {
    const { rerender } = render(
      <ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo="data:image/png;base64,abc" />
    )

    expect(document.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,abc')

    rerender(<ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo="icon:openai" />)

    expect(screen.getByTestId('brand-icon')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('switches from an uploaded image to the generated fallback when the logo is reset', () => {
    const { rerender } = render(
      <ProviderAvatarPrimitive providerId="custom" providerName="Zeta" logo="data:image/png;base64,abc" />
    )

    expect(document.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,abc')

    rerender(<ProviderAvatarPrimitive providerId="custom" providerName="Zeta" logo={undefined} />)

    expect(screen.getByText('Z')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
