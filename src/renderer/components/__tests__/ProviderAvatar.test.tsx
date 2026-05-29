// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Resolve only `openai` to a recognizable stand-in icon; everything else is unknown.
vi.mock('@cherrystudio/ui/icons', () => ({
  resolveProviderIcon: (id: string) => (id === 'openai' ? () => <span data-testid="brand-icon" /> : undefined)
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

import { ProviderAvatarPrimitive } from '../ProviderAvatar'

afterEach(() => {
  cleanup()
})

describe('ProviderAvatarPrimitive', () => {
  it('resolves an `icon:<id>` logo to the built-in brand icon', () => {
    render(<ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo="icon:openai" />)

    expect(screen.getByTestId('brand-icon')).toBeInTheDocument()
    // The raw reference must not leak through as an image source.
    expect(document.querySelector('img')).toBeNull()
  })

  it('falls back to the name initial when an `icon:<id>` reference is unknown', () => {
    render(<ProviderAvatarPrimitive providerId="custom" providerName="Zeta" logo="icon:does-not-exist" />)

    expect(screen.queryByTestId('brand-icon')).not.toBeInTheDocument()
    expect(screen.getByText('Z')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
