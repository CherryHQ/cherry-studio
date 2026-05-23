import { fireEvent, render, screen } from '@testing-library/react'
import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  RightPaneHost
} from '../RightPaneHost'

const persistCacheMock = vi.hoisted(() => {
  const state = { width: 460 }

  return {
    state,
    setWidth: vi.fn((width: number) => {
      state.width = width
    })
  }
})

vi.mock('@renderer/utils', () => ({
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
  }
}))

describe('RightPaneHost', () => {
  afterEach(() => {
    persistCacheMock.state.width = ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH
    persistCacheMock.setWidth.mockClear()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  it('constrains the right pane to the chat shell height while preserving width', () => {
    render(
      <RightPaneHost open width={460}>
        <div>artifact pane</div>
      </RightPaneHost>
    )

    const host = screen.getByText('artifact pane').parentElement

    expect(host).toHaveClass('h-full', 'min-h-0', 'shrink-0', 'overflow-hidden')
  })

  it('does not render a resize handle by default', () => {
    const { container } = render(
      <RightPaneHost open width={460}>
        <div>artifact pane</div>
      </RightPaneHost>
    )

    expect(container.querySelector('[data-right-pane-resize-handle]')).not.toBeInTheDocument()
  })

  it('renders a left-edge resize handle when resizable', () => {
    const { container } = render(
      <RightPaneHost open resizable width={460}>
        <div>artifact pane</div>
      </RightPaneHost>
    )

    const handle = container.querySelector('[data-right-pane-resize-handle]')

    expect(handle).toBeInTheDocument()
    expect(handle).toHaveClass('left-0', 'cursor-col-resize')
  })

  it('notifies when the open animation completes', () => {
    const onOpenAnimationComplete = vi.fn()

    render(
      <RightPaneHost open width={460} onOpenAnimationComplete={onOpenAnimationComplete}>
        <div>artifact pane</div>
      </RightPaneHost>
    )

    const pane = screen.getByText('artifact pane').parentElement

    if (!pane) {
      throw new Error('Expected right pane')
    }

    fireEvent.animationEnd(pane)

    expect(onOpenAnimationComplete).toHaveBeenCalledTimes(1)
  })

  it('clamps drag width from the right edge and cleans document resize styles', () => {
    const onOpenAnimationComplete = vi.fn()
    const { container } = render(
      <RightPaneHost open resizable width={460} onOpenAnimationComplete={onOpenAnimationComplete}>
        <div>artifact pane</div>
      </RightPaneHost>
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

    fireEvent.animationEnd(pane)
    expect(onOpenAnimationComplete).not.toHaveBeenCalled()

    fireEvent.mouseMove(document, { clientX: 300 })
    fireEvent.mouseMove(document, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 20 })

    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(1, 500)
    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(2, ARTIFACT_RIGHT_PANE_MIN_WIDTH)
    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(3, ARTIFACT_RIGHT_PANE_MAX_WIDTH)

    fireEvent.mouseUp(document)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')
  })
})
