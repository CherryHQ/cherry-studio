import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useAnimationControls } from 'motion/react'
import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH
} from '../paneLayout'
import { PersistentRightPaneHost, RightPaneHost } from '../RightPaneHost'

const persistCacheMock = vi.hoisted(() => {
  const state = { width: 280 }

  return {
    state,
    setWidth: vi.fn((width: number) => {
      state.width = width
    })
  }
})

const motionTestState = vi.hoisted(() => ({
  controls: {
    set: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn()
  },
  reducedMotion: true
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: vi.fn(() => [persistCacheMock.state.width, persistCacheMock.setWidth])
}))

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  onAnimationComplete?: () => void
  transition?: unknown
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, onAnimationComplete, ...props }: MotionDivProps) => {
      const domProps = { ...props }
      delete domProps.animate
      delete domProps.exit
      delete domProps.initial
      delete domProps.transition

      return (
        <div {...domProps} onAnimationEnd={onAnimationComplete}>
          {children}
        </div>
      )
    }
  },
  // Real motion returns one stable controls instance per component; a fresh object
  // per render would re-run the host's cleanup effect and cancel in-flight phases.
  useAnimationControls: () => motionTestState.controls,
  useReducedMotion: () => motionTestState.reducedMotion
}))

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('RightPaneHost', () => {
  beforeEach(() => {
    motionTestState.controls.set.mockReset()
    motionTestState.controls.start.mockReset()
    motionTestState.controls.start.mockImplementation(() => Promise.resolve())
    motionTestState.controls.stop.mockReset()
    motionTestState.reducedMotion = true
  })

  afterEach(() => {
    persistCacheMock.state.width = ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH
    persistCacheMock.setWidth.mockClear()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  it('constrains the right pane to the chat shell height while preserving width', () => {
    const { container } = render(
      <RightPaneHost open width={460}>
        <div>artifact pane</div>
      </RightPaneHost>
    )

    const host = container.querySelector('[data-right-pane]')

    expect(host).toHaveClass('h-full', 'min-h-0', 'shrink-0', 'overflow-hidden')
  })

  it('disables pointer events on the pane content while resizing', () => {
    // A real mouse/document-level drag routes mousemove/mouseup to whatever DOM
    // element is under the cursor — an iframe (e.g. the HTML preview tab) swallows
    // those events instead of letting them bubble to this component's document
    // listeners. Shrinking the pane moves the cursor into space the content still
    // occupies before the resize catches up, so without this the drag looks stuck
    // as soon as the cursor crosses into an iframe. The content wrapper must carry
    // the pointer-events-none toggle (driven by the data-resizing group state) so
    // pointer events keep reaching the document-level listeners for the whole drag.
    render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    const contentWrapper = screen.getByText('artifact pane').parentElement

    expect(contentWrapper).toHaveClass('group-data-[resizing=true]/right-pane:pointer-events-none')
  })

  it('does not render a resize handle by default', () => {
    const { container } = render(
      <PersistentRightPaneHost open width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    expect(container.querySelector('[data-right-pane-resize-handle]')).not.toBeInTheDocument()
  })

  it('uses the configured right pane default and minimum widths', () => {
    expect(ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH).toBe(280)
    expect(ARTIFACT_RIGHT_PANE_MIN_WIDTH).toBe(280)
  })

  it('caps its width when reserving space for the conversation center', () => {
    const { container } = render(
      <PersistentRightPaneHost open width={460} reservedCenterWidth={360}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    const host = container.querySelector('[data-right-pane]')

    expect(host).toHaveStyle({ maxWidth: 'max(0px, calc(100% - 360px))' })
  })

  it('renders a left-edge resize handle when resizable', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')

    expect(handle).toBeInTheDocument()
    expect(handle).toHaveClass('left-0', 'cursor-col-resize')
  })

  it('keeps the resize handle above pane content overlays', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div className="absolute inset-0 z-20">preview overlay</div>
      </PersistentRightPaneHost>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')

    expect(handle).toBeInTheDocument()
    expect(handle).toHaveClass('z-30')
  })

  it('keeps one child instance across closed, docked, and maximized layouts', async () => {
    const lifecycle: string[] = []

    function StatefulPane() {
      const [count, setCount] = useState(0)

      useEffect(() => {
        lifecycle.push('mount')
        return () => {
          lifecycle.push('unmount')
        }
      }, [])

      return (
        <button type="button" onClick={() => setCount((current) => current + 1)}>
          pane state {count}
        </button>
      )
    }

    const { container, rerender } = render(
      <div className="relative">
        <PersistentRightPaneHost open width={460}>
          <StatefulPane />
        </PersistentRightPaneHost>
      </div>
    )
    const pane = screen.getByRole('button', { name: 'pane state 0' })
    fireEvent.click(pane)

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open={false} width={460}>
          <StatefulPane />
        </PersistentRightPaneHost>
      </div>
    )

    await waitFor(() => expect(container.querySelector('[data-right-pane]')).toHaveAttribute('inert'))
    // The fully closed pane is visibility:hidden, which strips accessible names —
    // query by text (visibility-agnostic) to assert the same instance survived.
    expect(screen.getByText('pane state 1', { selector: 'button' })).toBe(pane)

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open maximized width={460}>
          <StatefulPane />
        </PersistentRightPaneHost>
      </div>
    )

    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximized')
    )
    expect(screen.getByRole('button', { name: 'pane state 1' })).toBe(pane)
    expect(lifecycle).toEqual(['mount'])
  })

  it('wipes between the docked strip and full width without blanking the pane', async () => {
    const controls = useAnimationControls() as unknown as {
      set: ReturnType<typeof vi.fn>
      start: ReturnType<typeof vi.fn>
    }
    const dockedStripClip = 'inset(0% 0% 0% calc(100% - 460px))'
    const { container, rerender } = render(
      <div className="relative">
        <PersistentRightPaneHost open width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    controls.set.mockClear()
    controls.start.mockClear()

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open maximized width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximized')
    )
    // Maximize from docked starts the wipe at the strip the pane already occupies.
    expect(controls.set).toHaveBeenCalledWith(expect.objectContaining({ clipPath: dockedStripClip }))
    expect(controls.set).not.toHaveBeenCalledWith(expect.objectContaining({ clipPath: 'inset(0% 0% 0% 100%)' }))

    controls.set.mockClear()
    controls.start.mockClear()

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'docked')
    )
    // Minimize wipes down to that same strip instead of collapsing to nothing.
    expect(controls.start).toHaveBeenCalledWith(expect.objectContaining({ clipPath: dockedStripClip }))
  })

  it('starts the maximize wipe from the constrained docked width', async () => {
    const { rerender } = render(
      <div className="relative">
        <PersistentRightPaneHost open width={460} reservedCenterWidth={360}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )
    motionTestState.controls.set.mockClear()

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open maximized width={460} reservedCenterWidth={360}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    await waitFor(() =>
      expect(motionTestState.controls.set).toHaveBeenCalledWith({
        clipPath: 'inset(0% 0% 0% calc(100% - min(460px, max(0px, calc(100% - 360px)))))',
        opacity: 1
      })
    )
  })

  it('ignores a stale maximize completion when minimizing before it finishes', async () => {
    const firstAnimation = createDeferred()
    const secondAnimation = createDeferred()
    const onLayoutAnimationComplete = vi.fn()
    motionTestState.controls.start
      .mockImplementationOnce(() => firstAnimation.promise)
      .mockImplementationOnce(() => secondAnimation.promise)

    const { container, rerender } = render(
      <div className="relative">
        <PersistentRightPaneHost open width={460} onLayoutAnimationComplete={onLayoutAnimationComplete}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open maximized width={460} onLayoutAnimationComplete={onLayoutAnimationComplete}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'maximizing')

    rerender(
      <div className="relative">
        <PersistentRightPaneHost open width={460} onLayoutAnimationComplete={onLayoutAnimationComplete}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      </div>
    )

    expect(motionTestState.controls.stop).toHaveBeenCalled()
    expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'minimizing')

    await act(async () => firstAnimation.resolve())

    expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'minimizing')
    expect(onLayoutAnimationComplete).not.toHaveBeenCalled()

    await act(async () => secondAnimation.resolve())

    await waitFor(() =>
      expect(container.querySelector('[data-right-pane]')).toHaveAttribute('data-right-pane-phase', 'docked')
    )
    expect(onLayoutAnimationComplete).toHaveBeenCalledTimes(1)
    expect(onLayoutAnimationComplete).toHaveBeenCalledWith('docked')
  })

  it('commits the final drag width once on mouse up and cleans document resize styles', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )
    const pane = container.querySelector('[data-right-pane]')
    const handle = container.querySelector('[data-right-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected right pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

    fireEvent.mouseDown(handle, { clientX: 340 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')

    fireEvent.mouseMove(document, { clientX: 300 })
    fireEvent.mouseMove(document, { clientX: 600 })
    fireEvent.mouseMove(document, { clientX: 20 })

    // No commits to the persisted cache while the drag is in progress — the
    // rAF-batched live width never touches usePersistCache.
    expect(persistCacheMock.setWidth).not.toHaveBeenCalled()

    fireEvent.mouseUp(document)

    // Exactly one commit, with the last mousemove's clamped width (800 - 20 = 780,
    // clamped down to the max).
    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(ARTIFACT_RIGHT_PANE_MAX_WIDTH)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')
  })

  it('does not commit to the persisted cache before window blur ends the drag', () => {
    const { container } = render(
      <PersistentRightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </PersistentRightPaneHost>
    )
    const pane = container.querySelector('[data-right-pane]')
    const handle = container.querySelector('[data-right-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected right pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

    fireEvent.mouseDown(handle, { clientX: 340 })
    fireEvent.mouseMove(document, { clientX: 300 })
    expect(pane).toHaveAttribute('data-resizing', 'true')
    expect(document.body.style.cursor).toBe('col-resize')
    expect(persistCacheMock.setWidth).not.toHaveBeenCalled()

    fireEvent.blur(window)

    // Blur ends the drag, committing the last pending width once (800 - 300 = 500).
    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(500)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')

    fireEvent.mouseMove(document, { clientX: 20 })

    // The drag already ended — a later mousemove must not commit again.
    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
  })

  describe('rAF-batched drag width', () => {
    let rafCallbacks: FrameRequestCallback[]
    let nextRafId: number
    const originalRaf = window.requestAnimationFrame
    const originalCancelRaf = window.cancelAnimationFrame

    beforeEach(() => {
      rafCallbacks = []
      nextRafId = 1
      window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback)
        return nextRafId++
      }) as typeof window.requestAnimationFrame
      window.cancelAnimationFrame = vi.fn()
    })

    afterEach(() => {
      window.requestAnimationFrame = originalRaf
      window.cancelAnimationFrame = originalCancelRaf
    })

    function flushRaf() {
      const callbacks = rafCallbacks
      rafCallbacks = []
      act(() => {
        callbacks.forEach((callback) => callback(0))
      })
    }

    it('schedules at most one rAF-driven width update per animation frame', () => {
      const { container } = render(
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      )
      const pane = container.querySelector('[data-right-pane]')
      const handle = container.querySelector('[data-right-pane-resize-handle]')

      if (!pane || !handle) {
        throw new Error('Expected right pane and resize handle')
      }

      vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

      fireEvent.mouseDown(handle, { clientX: 340 })

      fireEvent.mouseMove(document, { clientX: 300 })
      fireEvent.mouseMove(document, { clientX: 320 })
      fireEvent.mouseMove(document, { clientX: 310 })

      // Three mousemoves within the same (un-flushed) frame only schedule once.
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)

      flushRaf()

      fireEvent.mouseMove(document, { clientX: 305 })

      // The previous flush cleared the "scheduled" flag, so a new move schedules again.
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2)

      fireEvent.mouseUp(document)
    })

    it('commits immediately via the keyboard/a11y path, bypassing rAF', () => {
      const { container } = render(
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      )
      const handle = container.querySelector('[data-right-pane-resize-handle]')

      if (!handle) {
        throw new Error('Expected resize handle')
      }

      // The handle uses `invert: true`, so ArrowLeft grows the pane.
      fireEvent.keyDown(handle, { key: 'ArrowLeft' })

      expect(window.requestAnimationFrame).not.toHaveBeenCalled()
      expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
    })

    it('cancels a pending rAF and does not update state after unmount', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { container, unmount } = render(
        <PersistentRightPaneHost open resizable width={460}>
          <div>artifact pane</div>
        </PersistentRightPaneHost>
      )
      const pane = container.querySelector('[data-right-pane]')
      const handle = container.querySelector('[data-right-pane-resize-handle]')

      if (!pane || !handle) {
        throw new Error('Expected right pane and resize handle')
      }

      vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(340, 0, 460, 500))

      fireEvent.mouseDown(handle, { clientX: 340 })
      fireEvent.mouseMove(document, { clientX: 300 })

      expect(rafCallbacks).toHaveLength(1)

      unmount()

      // Drag end (fired by useResizeDrag's own unmount cleanup) cancels the pending rAF.
      expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1)

      // Flushing the rAF callback captured before unmount must not throw or
      // trigger a React "state update on an unmounted component" warning.
      expect(() => flushRaf()).not.toThrow()
      expect(consoleError).not.toHaveBeenCalled()

      consoleError.mockRestore()
    })
  })
})
