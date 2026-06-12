import { PortalContainerProvider } from '@cherrystudio/ui'
import { render, screen, waitFor } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openAutoFocusEvents, popoverContentProps, portalContainerMock } = vi.hoisted(() => ({
  openAutoFocusEvents: [] as Array<{ preventDefault: ReturnType<typeof vi.fn>; defaultPrevented: boolean }>,
  popoverContentProps: [] as Array<{
    align?: string
    side?: string
    sideOffset?: number
    collisionPadding?: number
    portalContainer?: unknown
  }>,
  portalContainerMock: {
    current: null as HTMLElement | null
  }
}))

const originalResizeObserver = globalThis.ResizeObserver

vi.mock('@cherrystudio/ui', () => ({
  Input: ({ ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: RefObject<HTMLInputElement | null> }) => (
    <input ref={ref} {...props} />
  ),
  PortalContainerProvider: ({ children, container }: { children: ReactNode; container: HTMLElement | null }) => {
    portalContainerMock.current = container
    return <>{children}</>
  },
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({
    children,
    onOpenAutoFocus,
    align,
    side,
    sideOffset,
    collisionPadding,
    portalContainer,
    forceMount,
    onInteractOutside,
    ...props
  }: {
    children: ReactNode
    onOpenAutoFocus?: (event: { preventDefault: () => void; defaultPrevented: boolean }) => void
    align?: string
    side?: string
    sideOffset?: number
    collisionPadding?: number
    portalContainer?: unknown
    forceMount?: unknown
    onInteractOutside?: unknown
  }) => {
    popoverContentProps.push({ align, side, sideOffset, collisionPadding, portalContainer })
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
  Switch: () => <button type="button" role="switch" />,
  usePortalContainer: () => portalContainerMock.current
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

import { DEFAULT_SELECTOR_CONTENT_HEIGHT, SelectorShell } from '../shell/SelectorShell'

describe('SelectorShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.ResizeObserver = originalResizeObserver
    openAutoFocusEvents.length = 0
    popoverContentProps.length = 0
    portalContainerMock.current = null
  })

  it('defaults popover placement to bottom with viewport padding', () => {
    render(
      <SelectorShell trigger={<button type="button">Open</button>} open onOpenChange={vi.fn()}>
        <div />
      </SelectorShell>
    )

    expect(popoverContentProps.at(-1)).toMatchObject({
      side: 'bottom',
      align: 'start',
      sideOffset: 4,
      collisionPadding: 12
    })
  })

  it('applies contentHeight as a fixed popover target height', () => {
    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        contentHeight={DEFAULT_SELECTOR_CONTENT_HEIGHT}>
        <div />
      </SelectorShell>
    )

    const content = document.querySelector<HTMLElement>('[data-selector-shell-content]')
    expect(content).toHaveStyle({ height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px` })
    expect(content?.style.maxHeight).toBe('')
  })

  it('does not set a fixed popover target height by default', () => {
    render(
      <SelectorShell trigger={<button type="button">Open</button>} open onOpenChange={vi.fn()}>
        <div />
      </SelectorShell>
    )

    expect(document.querySelector<HTMLElement>('[data-selector-shell-content]')?.style.height).toBe('')
  })

  it('uses contentHeight when measuring available list height', async () => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element)
      const isContent = element instanceof HTMLElement && element.getAttribute('data-selector-shell-content') === 'true'
      if (!isContent) return style

      Object.defineProperties(style, {
        height: { configurable: true, value: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px` },
        paddingTop: { configurable: true, value: '0px' },
        paddingBottom: { configurable: true, value: '0px' }
      })
      vi.spyOn(style, 'getPropertyValue').mockImplementation((property: string) =>
        property === '--radix-popover-content-available-height'
          ? '500px'
          : CSSStyleDeclaration.prototype.getPropertyValue.call(style, property)
      )
      return style
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isChrome = this.hasAttribute('data-selector-shell-chrome')
      return {
        x: 0,
        y: 0,
        width: 320,
        height: isChrome ? 20 : 0,
        top: 0,
        right: 320,
        bottom: isChrome ? 20 : 0,
        left: 0,
        toJSON: () => {}
      }
    })

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        contentHeight={DEFAULT_SELECTOR_CONTENT_HEIGHT}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}>
        {({ availableListHeight }) => <div data-testid="available-height">{availableListHeight}</div>}
      </SelectorShell>
    )

    await waitFor(() =>
      expect(screen.getByTestId('available-height')).toHaveTextContent(String(DEFAULT_SELECTOR_CONTENT_HEIGHT - 20))
    )
  })

  it('lets contentProps override collision padding', () => {
    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        contentProps={{ collisionPadding: 24 }}>
        <div />
      </SelectorShell>
    )

    expect(popoverContentProps.at(-1)).toMatchObject({ collisionPadding: 24 })
  })

  it('uses the nearest page portal container by default', () => {
    const pagePortalContainer = document.createElement('div')

    render(
      <PortalContainerProvider container={pagePortalContainer}>
        <SelectorShell trigger={<button type="button">Open</button>} open onOpenChange={vi.fn()}>
          <div />
        </SelectorShell>
      </PortalContainerProvider>
    )

    expect(popoverContentProps.at(-1)?.portalContainer).toBe(pagePortalContainer)
  })

  it('falls back to a local portal container without a page provider', () => {
    render(
      <SelectorShell trigger={<button type="button">Open</button>} open onOpenChange={vi.fn()}>
        <div />
      </SelectorShell>
    )

    expect(popoverContentProps.at(-1)?.portalContainer).toBeInstanceOf(HTMLElement)
    expect(popoverContentProps.at(-1)?.portalContainer).not.toBe(document.body)
  })

  it('lets callers override the page portal container', () => {
    const pagePortalContainer = document.createElement('div')
    const portalContainer = document.createElement('div')

    render(
      <PortalContainerProvider container={pagePortalContainer}>
        <SelectorShell
          trigger={<button type="button">Open</button>}
          open
          onOpenChange={vi.fn()}
          portalContainer={portalContainer}>
          <div />
        </SelectorShell>
      </PortalContainerProvider>
    )

    expect(popoverContentProps.at(-1)?.portalContainer).toBe(portalContainer)
  })

  it('subtracts selector chrome from available list height', async () => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element)
      const isContent = element instanceof HTMLElement && element.getAttribute('data-selector-shell-content') === 'true'
      if (!isContent) return style

      Object.defineProperties(style, {
        paddingTop: { configurable: true, value: '4px' },
        paddingBottom: { configurable: true, value: '4px' }
      })
      vi.spyOn(style, 'getPropertyValue').mockImplementation((property: string) =>
        property === '--radix-popover-content-available-height'
          ? '200px'
          : CSSStyleDeclaration.prototype.getPropertyValue.call(style, property)
      )
      return style
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isChrome = this.hasAttribute('data-selector-shell-chrome')
      return {
        x: 0,
        y: 0,
        width: 320,
        height: isChrome ? 20 : 0,
        top: 0,
        right: 320,
        bottom: isChrome ? 20 : 0,
        left: 0,
        toJSON: () => {}
      }
    })

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}
        filterContent={<span>Filter</span>}
        multiSelect={{ label: 'Multi', checked: false, onCheckedChange: vi.fn() }}
        bottomAction={{ label: 'Create', onClick: vi.fn() }}>
        {({ availableListHeight }) => <div data-testid="available-height">{availableListHeight}</div>}
      </SelectorShell>
    )

    await waitFor(() => expect(screen.getByTestId('available-height')).toHaveTextContent('112'))
  })

  it('uses maxContentHeight as the popover cap before measuring list height', async () => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element)
      const isContent = element instanceof HTMLElement && element.getAttribute('data-selector-shell-content') === 'true'
      if (!isContent) return style

      Object.defineProperties(style, {
        maxHeight: { configurable: true, value: '160px' },
        paddingTop: { configurable: true, value: '0px' },
        paddingBottom: { configurable: true, value: '0px' }
      })
      vi.spyOn(style, 'getPropertyValue').mockImplementation((property: string) =>
        property === '--radix-popover-content-available-height'
          ? '500px'
          : CSSStyleDeclaration.prototype.getPropertyValue.call(style, property)
      )
      return style
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isChrome = this.hasAttribute('data-selector-shell-chrome')
      return {
        x: 0,
        y: 0,
        width: 320,
        height: isChrome ? 20 : 0,
        top: 0,
        right: 320,
        bottom: isChrome ? 20 : 0,
        left: 0,
        toJSON: () => {}
      }
    })

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        maxContentHeight={160}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}>
        {({ availableListHeight }) => <div data-testid="available-height">{availableListHeight}</div>}
      </SelectorShell>
    )

    await waitFor(() => expect(screen.getByTestId('available-height')).toHaveTextContent('140'))
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

  it('does not expose a lazy-kept placement placeholder as available height', () => {
    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        mountStrategy="lazy-keep"
        side="bottom">
        {({ availableListHeight }) => <div data-testid="available-height">{String(availableListHeight)}</div>}
      </SelectorShell>
    )

    expect(screen.getByTestId('available-height')).toHaveTextContent('undefined')
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
    const resizeListenerCount = addEventListenerSpy.mock.calls.filter(
      ([eventName]) => (eventName as string) === 'resize'
    ).length
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

    expect(addEventListenerSpy.mock.calls.filter(([eventName]) => (eventName as string) === 'resize')).toHaveLength(
      resizeListenerCount
    )
    expect(disconnect).toHaveBeenCalledTimes(disconnectCount)
  })
})
