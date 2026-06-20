// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the REAL Radix avatar primitives instead of the dumb-passthrough mock that
// tests/renderer.setup.ts installs for `@cherrystudio/ui`. The blank-avatar regression lives
// entirely in Radix's `imageLoadingStatus` state machine, which the global mock bypasses — so
// only a real-Radix render can guard the fix. Import via the package-internal path so Radix
// resolves from within `packages/ui` (it is not hoisted to the repo-root node_modules).
vi.mock('@cherrystudio/ui', async () => {
  const avatar = (await vi.importActual('@cherrystudio/ui/components/primitives/avatar')) as Record<string, unknown>
  return {
    Avatar: avatar.Avatar,
    AvatarImage: avatar.AvatarImage,
    AvatarFallback: avatar.AvatarFallback
  }
})

// Resolve only `openai` to a recognizable stand-in icon; everything else is unknown.
vi.mock('@cherrystudio/ui/icons', () => ({
  resolveProviderIcon: (id: string) => (id === 'openai' ? () => <span data-testid="brand-icon" /> : undefined)
}))

import { ProviderAvatarPrimitive } from '../ProviderAvatar'

// Radix decides an image is `loaded` via `image.complete && image.naturalWidth > 0`. jsdom never
// actually loads images, so stub `window.Image` to report a successful load the moment `src` is
// set — that drives the avatar into the `loaded` state that triggers the bug.
class StubImage {
  complete = false
  naturalWidth = 0
  private _src = ''
  addEventListener() {}
  removeEventListener() {}
  set src(value: string) {
    this._src = value
    this.complete = true
    this.naturalWidth = 1
  }
  get src() {
    return this._src
  }
}

const IMAGE_LOGO = 'data:image/png;base64,abc'

beforeEach(() => {
  vi.stubGlobal('Image', StubImage as unknown as typeof Image)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProviderAvatarPrimitive (real Radix avatar)', () => {
  it('renders the loaded image and suppresses the fallback', () => {
    render(<ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo={IMAGE_LOGO} />)

    expect(document.querySelector('img')).toHaveAttribute('src', IMAGE_LOGO)
    // While the image is loaded, Radix hides the fallback initial.
    expect(screen.queryByText('C')).not.toBeInTheDocument()
  })

  it('shows the built-in icon after switching from a loaded image (preset selection)', () => {
    const { rerender } = render(<ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo={IMAGE_LOGO} />)
    expect(document.querySelector('img')).toHaveAttribute('src', IMAGE_LOGO)

    rerender(<ProviderAvatarPrimitive providerId="custom" providerName="Custom" logo="icon:openai" />)

    // Without the key-remount fix, the reused <Avatar> root keeps its stale `loaded` status and
    // suppresses this fallback-hosted icon, leaving a blank avatar.
    expect(screen.getByTestId('brand-icon')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows the generated initial after resetting a loaded image', () => {
    const { rerender } = render(<ProviderAvatarPrimitive providerId="custom" providerName="Zeta" logo={IMAGE_LOGO} />)
    expect(document.querySelector('img')).toHaveAttribute('src', IMAGE_LOGO)

    rerender(<ProviderAvatarPrimitive providerId="custom" providerName="Zeta" logo={undefined} />)

    expect(screen.getByText('Z')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
