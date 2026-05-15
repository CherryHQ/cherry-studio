import { render, screen, waitFor } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openAutoFocusEvents } = vi.hoisted(() => ({
  openAutoFocusEvents: [] as Array<{ preventDefault: ReturnType<typeof vi.fn>; defaultPrevented: boolean }>
}))

const originalResizeObserver = globalThis.ResizeObserver

vi.mock('@cherrystudio/ui', () => ({
  Input: ({ ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: RefObject<HTMLInputElement | null> }) => (
    <input ref={ref} {...props} />
  ),
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({
    children,
    onOpenAutoFocus,
    align,
    side,
    sideOffset,
    forceMount,
    onInteractOutside,
    ...props
  }: {
    children: ReactNode
    onOpenAutoFocus?: (event: { preventDefault: () => void; defaultPrevented: boolean }) => void
    align?: string
    side?: string
    sideOffset?: number
    forceMount?: unknown
    onInteractOutside?: unknown
  }) => {
    void align
    void side
    void sideOffset
    void forceMount
    void onInteractOutside
    const event = {
      preventDefault: vi.fn(() => {
        event.defaultPrevented = true
      }),
      defaultPrevented: false
    }
    openAutoFocusEvents.push(event)
    onOpenAutoFocus?.(event)
    return <div {...props}>{children}</div>
  },
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Switch: () => <button type="button" role="switch" />
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

import { SelectorShell } from '../shell/SelectorShell'

describe('SelectorShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.ResizeObserver = originalResizeObserver
    openAutoFocusEvents.length = 0
  })

  it('does not force focus into search when search autoFocus is false', async () => {
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search',
          autoFocus: false
        }}>
        <div />
      </SelectorShell>
    )

    await waitFor(() => expect(openAutoFocusEvents).toHaveLength(1))
    expect(openAutoFocusEvents[0]?.preventDefault).not.toHaveBeenCalled()
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('does not build lazy-kept content before the first open', () => {
    const renderContent = vi.fn(() => <div data-testid="lazy-body" />)

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open={false}
        onOpenChange={vi.fn()}
        mountStrategy="lazy-keep">
        {renderContent}
      </SelectorShell>
    )

    expect(renderContent).not.toHaveBeenCalled()
    expect(screen.queryByTestId('lazy-body')).not.toBeInTheDocument()
  })

  it('does not rebind measurement listeners when config object identities change', async () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    globalThis.ResizeObserver = vi.fn(
      () =>
        ({
          observe,
          disconnect
        }) as unknown as ResizeObserver
    ) as unknown as typeof ResizeObserver
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

    const { rerender } = render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}
        filterContent={<span>Filter</span>}>
        <div />
      </SelectorShell>
    )

    await waitFor(() => expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function)))
    const resizeListenerCount = addEventListenerSpy.mock.calls.filter(([eventName]) => eventName === 'resize').length
    const disconnectCount = disconnect.mock.calls.length

    rerender(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}
        filterContent={<span>Filter again</span>}>
        <div />
      </SelectorShell>
    )

    expect(addEventListenerSpy.mock.calls.filter(([eventName]) => eventName === 'resize')).toHaveLength(
      resizeListenerCount
    )
    expect(disconnect).toHaveBeenCalledTimes(disconnectCount)
  })
})
