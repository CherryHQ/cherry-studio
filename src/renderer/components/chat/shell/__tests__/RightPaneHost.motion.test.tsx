import { render, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PersistentRightPaneHost } from '../RightPaneHost'

const persistCacheMock = vi.hoisted(() => ({ width: 460 }))

vi.mock('@data/hooks/useCache', () => ({
  useCache: vi.fn(() => [undefined, vi.fn()]),
  usePersistCache: vi.fn(() => [persistCacheMock.width, vi.fn()])
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

const MAIN_REGION_WIDTH = 800
/** `resolveDockedPaneWidth(800, 460)`: the pane yields to the centre's 360px floor. */
const DOCKED_SPACER_WIDTH = 440

/**
 * Motion is deliberately NOT mocked here. Every other suite in this directory replaces it, which
 * leaves the pane's width provable only through `controls.start` payloads — an internal
 * collaborator. Disconnecting `animate={animationControls}` would keep those green while the pane
 * stopped resizing, so this file asserts the width Motion actually writes.
 */
describe('PersistentRightPaneHost width (real Motion)', () => {
  beforeEach(() => {
    // Reduced motion collapses every transition to duration 0, so each settled phase is observable
    // without waiting on animation frames.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn()
      }))
    )
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, MAIN_REGION_WIDTH, 500))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('writes the pane box width for each layout, not just the animation payload', async () => {
    const Harness = ({ maximized }: { maximized: boolean }) => (
      <div className="relative">
        <PersistentRightPaneHost open maximized={maximized} width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    const { container, rerender } = render(<Harness maximized={false} />)
    const pane = () => container.querySelector<HTMLElement>('[data-right-pane]') as HTMLElement
    const spacer = () => container.querySelector<HTMLElement>('[data-right-pane-spacer]') as HTMLElement

    // The inline width is the contract here: it is the layout mechanic this pane animates.
    // 460 requested against an 800px region resolves to 440. Motion interpolates the width it is
    // handed, so a spacer animating the raw 460 would sit clamped at 440 until the two cross and
    // arrive out of step with the pane it reserves space for.
    await waitFor(() => {
      expect(pane().style.width).not.toBe('')
      expect(spacer().style.width).toBe(`${DOCKED_SPACER_WIDTH}px`)
    })
    const dockedWidth = pane().style.width
    expect(dockedWidth).toContain('min(460px')

    rerender(<Harness maximized />)
    await waitFor(() => {
      expect(pane().style.width).toBe('100%')
      expect(spacer().style.width).toBe('0px')
    })

    rerender(<Harness maximized={false} />)
    await waitFor(() => {
      expect(pane().style.width).toBe(dockedWidth)
      expect(spacer().style.width).toBe(`${DOCKED_SPACER_WIDTH}px`)
    })
  })
})
