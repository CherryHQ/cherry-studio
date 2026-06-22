import { act, render, screen } from '@testing-library/react'
import { type HTMLAttributes, type PropsWithChildren, type ReactNode, type Ref, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useImmersiveNavbar, useReportImmersiveNarrow } from '../../layout/ImmersiveNavbarContext'
import { ChatAppShell } from '../ChatAppShell'

// ChatAppShell owns the float decision: it measures its OWN center width and reads a `narrow`
// boolean the message list reports up. jsdom has no layout, so we drive the center width through a
// stubbed ResizeObserver. Embedded threshold = column 848 + reserve 116 = 964px.

vi.mock('@renderer/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: vi.fn(() => [240, vi.fn()])
}))

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  layout?: unknown
  ref?: Ref<HTMLDivElement>
  transition?: unknown
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ ref, children, animate, exit, initial, layout, transition, ...rest }: MotionDivProps) => {
      void animate
      void exit
      void initial
      void layout
      void transition
      return (
        <div ref={ref} {...rest}>
          {children}
        </div>
      )
    }
  }
}))

interface CapturedResizeObserver {
  callback: ResizeObserverCallback
  targets: Set<Element>
}

let resizeObservers: CapturedResizeObserver[] = []

beforeEach(() => {
  resizeObservers = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly instance: CapturedResizeObserver
      constructor(callback: ResizeObserverCallback) {
        this.instance = { callback, targets: new Set() }
        resizeObservers.push(this.instance)
      }
      observe(target: Element) {
        this.instance.targets.add(target)
      }
      disconnect() {}
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Feed a center width to every captured observer. The center-width observer applies it; the
// pane auto-collapse observer reads it too but no-ops on the first entry.
function setCenterWidth(width: number) {
  act(() => {
    for (const observer of resizeObservers) {
      observer.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
    }
  })
}

function NarrowProbe({ narrow }: { narrow: boolean }) {
  const reportNarrow = useReportImmersiveNarrow()
  const { insetHeight } = useImmersiveNavbar()
  useEffect(() => {
    reportNarrow(narrow)
  }, [reportNarrow, narrow])
  return <span data-testid="inset">{insetHeight}</span>
}

describe('ChatAppShell immersive navbar', () => {
  it('floats the navbar and exposes the inset when narrow and the center is wide enough', () => {
    render(<ChatAppShell topBar={<div data-testid="navbar" />} centerContent={<NarrowProbe narrow />} />)
    setCenterWidth(1200)

    const wrapper = screen.getByTestId('navbar').parentElement as HTMLElement
    expect(wrapper).toHaveClass('absolute')
    expect(wrapper).not.toHaveClass('relative')
    expect(wrapper).toHaveClass('[&_[data-conversation-shell-topbar]::after]:hidden')
    expect(wrapper).toHaveAttribute('data-chat-navbar-floating')
    expect(screen.getByTestId('inset')).toHaveTextContent('44')
  })

  it('keeps the navbar in flow when the center is below the threshold', () => {
    render(<ChatAppShell topBar={<div data-testid="navbar" />} centerContent={<NarrowProbe narrow />} />)
    setCenterWidth(900)

    const wrapper = screen.getByTestId('navbar').parentElement as HTMLElement
    expect(wrapper).toHaveClass('relative')
    expect(wrapper).not.toHaveClass('[&_[data-conversation-shell-topbar]::after]:hidden')
    expect(wrapper).not.toHaveAttribute('data-chat-navbar-floating')
    expect(screen.getByTestId('inset')).toHaveTextContent('0')
  })

  it('keeps the navbar in flow when the column is not narrow, even at wide widths', () => {
    render(<ChatAppShell topBar={<div data-testid="navbar" />} centerContent={<NarrowProbe narrow={false} />} />)
    setCenterWidth(1600)

    const wrapper = screen.getByTestId('navbar').parentElement as HTMLElement
    expect(wrapper).toHaveClass('relative')
    expect(wrapper).not.toHaveAttribute('data-chat-navbar-floating')
    expect(screen.getByTestId('inset')).toHaveTextContent('0')
  })
})
