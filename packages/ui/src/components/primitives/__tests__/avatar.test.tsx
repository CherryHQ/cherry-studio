// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Avatar, AvatarFallback, AvatarImage } from '../avatar'

// Radix decides an image is `loaded` via `image.complete && image.naturalWidth > 0`. jsdom never
// actually loads images, so stub `window.Image` to report a successful load the moment `src` is
// set — that drives Avatar.Root into the `loaded` status that triggered the original bug.
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

const FIRST_LOGO = 'data:image/png;base64,first'
const SECOND_LOGO = 'data:image/png;base64,second'

beforeEach(() => {
  vi.stubGlobal('Image', StubImage as unknown as typeof Image)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Avatar (Radix imageLoadingStatus reset)', () => {
  it('renders the loaded image and suppresses the fallback', () => {
    render(
      <Avatar>
        <AvatarImage src={FIRST_LOGO} />
        <AvatarFallback>F</AvatarFallback>
      </Avatar>
    )

    expect(document.querySelector('img')).toHaveAttribute('src', FIRST_LOGO)
    expect(screen.queryByText('F')).not.toBeInTheDocument()
  })

  it('shows the fallback after the image is removed from the tree', () => {
    const { rerender } = render(
      <Avatar>
        <AvatarImage src={FIRST_LOGO} />
        <AvatarFallback>F</AvatarFallback>
      </Avatar>
    )
    expect(document.querySelector('img')).toHaveAttribute('src', FIRST_LOGO)

    rerender(
      <Avatar>
        <AvatarFallback>F</AvatarFallback>
      </Avatar>
    )

    // Without the auto-remount, the Root would stay in `loaded` and hide the fallback.
    expect(screen.getByText('F')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('remounts the root when the image src changes', () => {
    const { rerender } = render(
      <Avatar>
        <AvatarImage src={FIRST_LOGO} />
        <AvatarFallback>F</AvatarFallback>
      </Avatar>
    )
    expect(document.querySelector('img')).toHaveAttribute('src', FIRST_LOGO)

    rerender(
      <Avatar>
        <AvatarImage src={SECOND_LOGO} />
        <AvatarFallback>F</AvatarFallback>
      </Avatar>
    )

    expect(document.querySelector('img')).toHaveAttribute('src', SECOND_LOGO)
  })

  it('does not remount the root when unrelated props change', () => {
    const { rerender } = render(
      <Avatar className="size-8">
        <AvatarImage src={FIRST_LOGO} />
      </Avatar>
    )
    const imgBefore = document.querySelector('img')

    rerender(
      <Avatar className="size-10">
        <AvatarImage src={FIRST_LOGO} />
      </Avatar>
    )

    // Same image node, same DOM identity — no remount when only className changes.
    expect(document.querySelector('img')).toBe(imgBefore)
  })
})
