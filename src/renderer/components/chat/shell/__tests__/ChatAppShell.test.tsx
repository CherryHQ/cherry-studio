import { WindowFrameProvider } from '@renderer/components/chat/shell/WindowFrameContext'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HTMLAttributes, PropsWithChildren, ReactNode, Ref } from 'react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatAppShell } from '../ChatAppShell'
import {
  CHAT_CENTER_MIN_USABLE_WIDTH,
  RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD,
  RESOURCE_LIST_PANE_DEFAULT_WIDTH,
  RESOURCE_LIST_PANE_MAX_WIDTH,
  RESOURCE_LIST_PANE_MIN_WIDTH
} from '../paneLayout'

const originalResizeObserver = globalThis.ResizeObserver

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const resizeObserverMockInstances: ResizeObserverMockInstance[] = []

const persistCacheMock = vi.hoisted(() => {
  const state = { width: 240 }

  return {
    state,
    setWidth: vi.fn((width: number) => {
      state.width = width
    })
  }
})

const rightPanelStateMock = vi.hoisted(() => ({
  current: undefined as { layoutAnimationPending: boolean; presentationMaximized: boolean } | undefined
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: vi.fn(() => [persistCacheMock.state.width, persistCacheMock.setWidth])
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('../../panes/Shell', () => ({
  useOptionalRightPanelState: () => rightPanelStateMock.current
}))

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  layout?: unknown
  ref?: Ref<HTMLDivElement>
  transition?: unknown
}

const getRequiredShellWidth = (paneWidth = RESOURCE_LIST_PANE_MIN_WIDTH) => paneWidth + CHAT_CENTER_MIN_USABLE_WIDTH

vi.mock('motion/react', () => {
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      div: ({ ref, children, ...props }: MotionDivProps) => {
        const domProps = { ...props }
        delete domProps.animate
        delete domProps.exit
        delete domProps.initial
        delete domProps.layout
        delete domProps.transition

        return (
          <div ref={ref} {...domProps}>
            {children}
          </div>
        )
      }
    }
  }
})

describe('ChatAppShell', () => {
  beforeEach(() => {
    rightPanelStateMock.current = undefined
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1200,
      writable: true
    })
    resizeObserverMockInstances.length = 0
    globalThis.ResizeObserver = vi.fn((callback: ResizeObserverCallback) => {
      const instance = {
        callback,
        observe: vi.fn(),
        disconnect: vi.fn()
      }
      resizeObserverMockInstances.push(instance)

      return {
        observe: instance.observe,
        disconnect: instance.disconnect
      } as unknown as ResizeObserver
    }) as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    persistCacheMock.state.width = RESOURCE_LIST_PANE_DEFAULT_WIDTH
    persistCacheMock.setWidth.mockClear()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.documentElement.style.removeProperty('--assistants-width')
    vi.restoreAllMocks()
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('renders side panel in a root overlay host above center layers', () => {
    const { container } = render(
      <ChatAppShell
        centerId="chat-main"
        topBar={<div data-testid="navbar" />}
        sidePanel={<div data-testid="settings-panel" />}
        main={<div data-testid="main" />}
      />
    )

    const chatMain = container.querySelector('#chat-main')
    const navbarWrapper = screen.getByTestId('navbar').parentElement

    expect(chatMain).toContainElement(screen.getByTestId('navbar'))
    expect(navbarWrapper).toHaveClass('relative', 'shrink-0', 'bg-background')
    expect(navbarWrapper).not.toHaveClass('absolute')
    expect(navbarWrapper).not.toHaveAttribute('data-chat-navbar-floating')
    expect(chatMain).not.toContainElement(screen.getByTestId('settings-panel'))
    expect(chatMain).toContainElement(screen.getByTestId('main'))
    expect(chatMain).toHaveClass('relative')

    const sidePanelHost = container.querySelector('[data-chat-side-panel-host]')
    expect(sidePanelHost).not.toBeNull()
    expect(sidePanelHost).toContainElement(screen.getByTestId('settings-panel'))
    expect(sidePanelHost).toHaveClass('pointer-events-none')
    expect(sidePanelHost).toHaveClass('absolute')
    expect(sidePanelHost).toHaveClass('inset-0')
    expect(sidePanelHost).toHaveClass('z-80')
    expect(sidePanelHost).toHaveClass('*:pointer-events-auto')
  })

  it('renders centerTopOverlay in a z-1000 overlay host that is a sibling of the center, not trapped inside it', () => {
    const { container } = render(
      <ChatAppShell
        centerId="chat-main"
        main={<div data-testid="main" />}
        centerTopOverlay={<div data-testid="search-overlay" />}
      />
    )

    const chatMain = container.querySelector('#chat-main')
    const overlay = screen.getByTestId('search-overlay')

    // Must NOT live inside the center: the center carries a transform (stacking context),
    // so an overlay trapped inside it cannot paint above sibling chrome at the shell root.
    expect(chatMain).not.toContainElement(overlay)

    const overlayHost = overlay.closest('.z-1000')
    expect(overlayHost).not.toBeNull()
    expect(overlayHost).toHaveClass('absolute')
    expect(overlayHost).toHaveClass('inset-0')

    // Sibling of the center (same wrapper) so it overlays exactly the center box.
    expect(overlayHost?.parentElement).toBe(chatMain?.parentElement)
  })

  it('releases the center stacking context while the right panel is maximized', () => {
    rightPanelStateMock.current = { layoutAnimationPending: false, presentationMaximized: true }

    const { container } = render(
      <ChatAppShell centerClassName="transform-[translateZ(0)]" main={<div data-testid="main" />} />
    )

    expect(container.querySelector('[data-chat-app-shell-center]')).toHaveClass(
      'transform-[translateZ(0)]',
      '!transform-none',
      '!will-change-auto'
    )
  })

  it('keeps the pane mounted when keyed center content changes', () => {
    const paneMounts: string[] = []

    function Pane() {
      const [count, setCount] = useState(0)

      useEffect(() => {
        paneMounts.push('mounted')
      }, [])

      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          pane count {count}
        </button>
      )
    }

    const { rerender } = render(
      <ChatAppShell
        pane={<Pane />}
        paneOpen
        centerContent={<div key="topic-1">topic 1 content</div>}
        topBar={<div>topic 1 nav</div>}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'pane count 0' }))

    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()

    rerender(
      <ChatAppShell
        pane={<Pane />}
        paneOpen
        centerContent={<div key="topic-2">topic 2 content</div>}
        topBar={<div>topic 2 nav</div>}
      />
    )

    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()
    expect(screen.queryByText('topic 1 content')).not.toBeInTheDocument()
    expect(screen.getByText('topic 2 content')).toBeInTheDocument()
    expect(paneMounts).toEqual(['mounted'])
  })

  it('drives the left resource pane width from persist cache', () => {
    persistCacheMock.state.width = 180

    render(<ChatAppShell pane={<aside>topics</aside>} paneOpen main={<div />} />)

    expect(document.documentElement.style.getPropertyValue('--assistants-width')).toBe(
      `${RESOURCE_LIST_PANE_MIN_WIDTH}px`
    )
  })

  it('keeps a detached conversation navbar inside the center beside the resource pane', () => {
    const { container } = render(
      <WindowFrameProvider value={{ mode: 'window' }}>
        <ChatAppShell
          contentId="conversation-content"
          centerId="conversation-center"
          topBar={<header data-testid="conversation-navbar" />}
          pane={<aside>topics</aside>}
          paneOpen
          main={<div />}
        />
      </WindowFrameProvider>
    )

    const pane = container.querySelector<HTMLElement>('[data-resource-list-pane]')
    const navbar = screen.getByTestId('conversation-navbar')
    const center = document.getElementById('conversation-center')
    const content = document.getElementById('conversation-content')

    if (!pane || !center || !content) {
      throw new Error('Expected resource pane, conversation center, and conversation content')
    }

    expect(pane.style.paddingTop).toBe('')
    expect(content).toContainElement(pane)
    expect(content).toContainElement(center)
    expect(center).toContainElement(navbar)
    expect(pane.compareDocumentPosition(center) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('saves drag width at or above the minimum and cleans document resize styles', () => {
    const onPaneCollapse = vi.fn()
    const { container } = render(
      <ChatAppShell pane={<aside>topics</aside>} paneOpen onPaneCollapse={onPaneCollapse} main={<div />} />
    )
    const pane = container.querySelector('[data-resource-list-pane]')
    const handle = container.querySelector('[data-resource-list-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected resource list pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 275, 500))

    fireEvent.mouseDown(handle, { clientX: 375 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')

    fireEvent.mouseMove(document, { clientX: 350 })
    fireEvent.mouseMove(document, { clientX: 600 })

    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(1, 250)
    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(2, RESOURCE_LIST_PANE_MAX_WIDTH)
    expect(onPaneCollapse).not.toHaveBeenCalled()

    fireEvent.mouseUp(document)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')
  })

  it('cleans the left resource pane resize state on window blur', () => {
    const { container } = render(<ChatAppShell pane={<aside>topics</aside>} paneOpen main={<div />} />)
    const pane = container.querySelector('[data-resource-list-pane]')
    const handle = container.querySelector('[data-resource-list-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected resource list pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 275, 500))

    fireEvent.mouseDown(handle, { clientX: 375 })
    fireEvent.mouseMove(document, { clientX: 350 })
    expect(pane).toHaveAttribute('data-resizing', 'true')
    expect(document.body.style.cursor).toBe('col-resize')
    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)

    fireEvent.blur(window)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')

    fireEvent.mouseMove(document, { clientX: 600 })

    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
  })

  it('clamps below-minimum drag width without collapsing when left drag is below the collapse threshold', () => {
    const onPaneCollapse = vi.fn()
    const { container } = render(
      <ChatAppShell pane={<aside>topics</aside>} paneOpen onPaneCollapse={onPaneCollapse} main={<div />} />
    )
    const pane = container.querySelector('[data-resource-list-pane]')
    const handle = container.querySelector('[data-resource-list-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected resource list pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, RESOURCE_LIST_PANE_MIN_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 340 })
    fireEvent.mouseMove(document, { clientX: 339 })

    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(RESOURCE_LIST_PANE_MIN_WIDTH)
    expect(onPaneCollapse).not.toHaveBeenCalled()
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')
  })

  it('collapses the left resource pane after resizing cleanup when dragging below the minimum width past the collapse threshold', async () => {
    let pane: Element | null = null
    const onPaneCollapse = vi.fn(() => {
      expect(pane).not.toHaveAttribute('data-resizing')
    })
    const { container } = render(
      <ChatAppShell pane={<aside>topics</aside>} paneOpen onPaneCollapse={onPaneCollapse} main={<div />} />
    )
    pane = container.querySelector('[data-resource-list-pane]')
    const handle = container.querySelector('[data-resource-list-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected resource list pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, RESOURCE_LIST_PANE_MIN_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 340 })
    fireEvent.mouseMove(document, { clientX: 340 - RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD - 1 })

    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(RESOURCE_LIST_PANE_DEFAULT_WIDTH)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')

    await waitFor(() => expect(onPaneCollapse).toHaveBeenCalledTimes(1))

    fireEvent.mouseMove(document, { clientX: 600 })

    expect(persistCacheMock.setWidth).toHaveBeenCalledTimes(1)
  })

  it('does not collapse on rightward drag even if the measured width is below the minimum', () => {
    const onPaneCollapse = vi.fn()
    const { container } = render(
      <ChatAppShell pane={<aside>topics</aside>} paneOpen onPaneCollapse={onPaneCollapse} main={<div />} />
    )
    const pane = container.querySelector('[data-resource-list-pane]')
    const handle = container.querySelector('[data-resource-list-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected resource list pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 0, RESOURCE_LIST_PANE_MIN_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 250 })
    fireEvent.mouseMove(document, { clientX: 260 })

    expect(persistCacheMock.setWidth).toHaveBeenCalledWith(RESOURCE_LIST_PANE_MIN_WIDTH)
    expect(onPaneCollapse).not.toHaveBeenCalled()
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')
  })

  it('reports responsive auto-collapse when the shell width cannot fit the left pane and center area', () => {
    const onPaneCollapse = vi.fn()
    const onPaneAutoCollapseChange = vi.fn()
    const requiredShellWidth = getRequiredShellWidth()

    render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneCollapse={onPaneCollapse}
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedShellWidth(requiredShellWidth)
    notifyObservedShellWidth(requiredShellWidth - 1)

    expect(onPaneAutoCollapseChange).toHaveBeenCalledWith(true)
    expect(onPaneCollapse).not.toHaveBeenCalled()
  })

  it('reports responsive auto-collapse when the center drops below its minimum usable width', async () => {
    const onPaneCollapse = vi.fn()
    const onPaneAutoCollapseChange = vi.fn()

    render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneCollapse={onPaneCollapse}
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH)
    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH - 1)

    await waitFor(() => {
      expect(onPaneAutoCollapseChange).toHaveBeenCalledWith(true)
    })
    expect(onPaneCollapse).not.toHaveBeenCalled()
  })

  it('reports responsive auto-restore when the shell can fit the left pane and center area again', () => {
    const onPaneAutoCollapseChange = vi.fn()
    const requiredShellWidth = getRequiredShellWidth()

    render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedShellWidth(requiredShellWidth)
    notifyObservedShellWidth(requiredShellWidth - 1)
    notifyObservedShellWidth(requiredShellWidth)

    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(1, true)
    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(2, false)
  })

  it('clears a reported responsive auto-collapse when the shell unmounts', () => {
    const onPaneAutoCollapseChange = vi.fn()
    const requiredShellWidth = getRequiredShellWidth()

    const { unmount } = render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedShellWidth(requiredShellWidth)
    notifyObservedShellWidth(requiredShellWidth - 1)
    unmount()

    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(1, true)
    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(2, false)
  })

  it('uses the current left pane width when deciding whether the shell can restore it', () => {
    const onPaneAutoCollapseChange = vi.fn()
    const requiredShellWidth = getRequiredShellWidth(RESOURCE_LIST_PANE_MAX_WIDTH)
    persistCacheMock.state.width = RESOURCE_LIST_PANE_MAX_WIDTH

    render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedShellWidth(requiredShellWidth)
    notifyObservedShellWidth(requiredShellWidth - 1)
    notifyObservedShellWidth(getRequiredShellWidth())

    expect(onPaneAutoCollapseChange).toHaveBeenCalledTimes(1)
    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(1, true)

    notifyObservedShellWidth(requiredShellWidth)

    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(2, false)
  })

  it('keeps the pane auto-collapsed until every responsive constraint has recovered', () => {
    const onPaneAutoCollapseChange = vi.fn()
    const requiredShellWidth = getRequiredShellWidth()

    render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedShellWidth(requiredShellWidth)
    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH - 1)
    notifyObservedShellWidth(requiredShellWidth - 1)
    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH)

    expect(onPaneAutoCollapseChange).toHaveBeenCalledTimes(1)
    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(1, true)

    notifyObservedShellWidth(requiredShellWidth)

    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(2, false)
  })

  it('does not auto-collapse from the first center width observation when the initial measurement is zero', () => {
    const onPaneAutoCollapseChange = vi.fn()

    render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH - 1)

    expect(onPaneAutoCollapseChange).not.toHaveBeenCalled()
  })

  it('reports responsive auto-restore when the center widens back above its minimum usable width', () => {
    const onPaneAutoCollapseChange = vi.fn()

    render(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        onPaneAutoCollapseChange={onPaneAutoCollapseChange}
        main={<div />}
      />
    )

    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH + 1)
    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH - 1)
    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH)

    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(1, true)
    expect(onPaneAutoCollapseChange).toHaveBeenNthCalledWith(2, false)
  })

  it('does not collapse from the initial shell width observation even when already below the required width', () => {
    const onPaneCollapse = vi.fn()

    render(<ChatAppShell pane={<aside>topics</aside>} paneOpen onPaneCollapse={onPaneCollapse} main={<div />} />)

    notifyObservedShellWidth(getRequiredShellWidth() - 1)

    expect(onPaneCollapse).not.toHaveBeenCalled()
  })

  it('allows manually opening the left pane while the shell is already below the required width', () => {
    const onPaneCollapse = vi.fn()
    const requiredShellWidth = getRequiredShellWidth()

    const { rerender } = render(
      <ChatAppShell pane={<aside>topics</aside>} paneOpen={false} onPaneCollapse={onPaneCollapse} main={<div />} />
    )

    notifyObservedShellWidth(requiredShellWidth - 1)
    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH - 1)
    rerender(<ChatAppShell pane={<aside>topics</aside>} paneOpen onPaneCollapse={onPaneCollapse} main={<div />} />)
    notifyObservedShellWidth(requiredShellWidth - 2)
    notifyObservedCenterWidth(CHAT_CENTER_MIN_USABLE_WIDTH - 2)

    expect(onPaneCollapse).not.toHaveBeenCalled()
  })

  it('does not auto-collapse when the pane is closed or positioned on the right', () => {
    const onPaneCollapse = vi.fn()
    const requiredShellWidth = getRequiredShellWidth()
    const { rerender } = render(
      <ChatAppShell pane={<aside>topics</aside>} paneOpen={false} onPaneCollapse={onPaneCollapse} main={<div />} />
    )

    notifyObservedShellWidth(requiredShellWidth)
    notifyObservedShellWidth(requiredShellWidth - 1)

    rerender(
      <ChatAppShell
        pane={<aside>topics</aside>}
        paneOpen
        panePosition="right"
        onPaneCollapse={onPaneCollapse}
        main={<div />}
      />
    )
    notifyObservedShellWidth(requiredShellWidth)
    notifyObservedShellWidth(requiredShellWidth - 1)

    expect(onPaneCollapse).not.toHaveBeenCalled()
  })

  it('does not auto-collapse from window resize alone', () => {
    const onPaneCollapse = vi.fn()
    const requiredShellWidth = getRequiredShellWidth()

    render(<ChatAppShell pane={<aside>topics</aside>} paneOpen onPaneCollapse={onPaneCollapse} main={<div />} />)

    notifyObservedShellWidth(requiredShellWidth)
    window.innerWidth = requiredShellWidth - 1
    fireEvent.resize(window)

    expect(onPaneCollapse).not.toHaveBeenCalled()
  })

  it('keeps the resize handle below history overlays', () => {
    const { container } = render(<ChatAppShell pane={<aside>topics</aside>} paneOpen main={<div />} />)
    const handle = container.querySelector('[data-resource-list-pane-resize-handle]')

    expect(handle).toHaveClass('z-10')
    expect(handle).not.toHaveClass('z-50')
  })
})

function notifyObservedShellWidth(width: number) {
  const { instance, target } = findResizeObserverTarget('[data-chat-app-shell-root]')
  act(() => {
    instance.callback(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, width, 0)
        } as ResizeObserverEntry
      ],
      {} as ResizeObserver
    )
  })
}

function notifyObservedCenterWidth(width: number) {
  const { instance, target } = findResizeObserverTarget('[data-chat-app-shell-center]')
  act(() => {
    instance.callback(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, width, 0)
        } as ResizeObserverEntry
      ],
      {} as ResizeObserver
    )
  })
}

function findResizeObserverTarget(selector: string) {
  const target = document.querySelector(selector)
  if (!target) {
    throw new Error(`Expected ${selector} to exist`)
  }

  const instance = resizeObserverMockInstances.find((candidate) =>
    candidate.observe.mock.calls.some(([observedTarget]) => observedTarget === target)
  )
  if (!instance) {
    throw new Error(`Expected ${selector} to be observed`)
  }

  return { instance, target }
}
