// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ShellTabBarActionsModule from '../ShellTabBarActions'

const mocks = vi.hoisted(() => ({
  emitResourceListReveal: vi.fn(),
  ipcRequest: vi.fn(() => Promise.resolve(undefined)),
  macTransparentState: { value: false },
  platformState: { isMac: false },
  showSearchPopup: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('@renderer/services/resourceListRevealEvents', () => ({
  emitResourceListReveal: mocks.emitResourceListReveal
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, variant, ...props }: React.ComponentProps<'button'> & { variant?: string }) => {
    void variant
    return (
      <button type={props.type ?? 'button'} {...props}>
        {children}
      </button>
    )
  },
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => mocks.macTransparentState.value
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return mocks.platformState.isMac
  },
  isLinux: false,
  isWin: false,
  platform: 'linux'
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => ({
  getMiniAppsLogoRef: () => undefined,
  useMiniAppLogo: () => undefined
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false]
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ settedTheme: 'light', toggleTheme: vi.fn() })
}))

vi.mock('@renderer/i18n/label', () => ({
  getThemeModeLabel: () => 'Light'
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

vi.mock('../ShellTabBarActions', async () => {
  const actual = await vi.importActual<typeof ShellTabBarActionsModule>('../ShellTabBarActions')
  return {
    ...actual,
    ShellTabBarActions: () => <div data-testid="shell-tab-actions" />
  }
})

vi.mock('../../WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => (key === 'title.launchpad' ? 'Launchpad' : key)
  })
}))

// Render the command context menu's extra items inline as buttons so each tab's
// "move to first" action is directly clickable without driving the real menu.
// The open/close toggles let tests drive onOpenChange the way both the cherry
// and native menu paths do at runtime.
vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems,
    onOpenChange
  }: {
    children: ReactNode
    extraItems?: Array<{ type: string; id?: string; label?: string; onSelect?: () => void }>
    onOpenChange?: (open: boolean) => void
  }) => (
    <div>
      {children}
      <button type="button" data-testid="menu-set-open" onClick={() => onOpenChange?.(true)} />
      <button type="button" data-testid="menu-set-closed" onClick={() => onOpenChange?.(false)} />
      {extraItems
        ?.filter((item) => item.type === 'item')
        .map((item) => (
          <button key={item.id} type="button" data-testid={`menu-${item.id}`} onClick={item.onSelect}>
            {item.label}
          </button>
        ))}
    </div>
  ),
  CommandTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { AppShellTabBar, getTabCapabilities } from '../AppShellTabBar'

const createTab = (id: string, overrides: Partial<Tab> = {}): Tab => ({
  id,
  type: 'route',
  url: id === 'home' ? '/app/chat' : `/app/${id}`,
  title: id === 'home' ? 'Chat' : id.toUpperCase(),
  ...overrides
})

const mockCloseAnimation = () => {
  const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 120,
    height: 30,
    top: 0,
    left: 0,
    right: 120,
    bottom: 30,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect)
  vi.useFakeTimers()
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16) as unknown as number
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))

  return () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    rectSpy.mockRestore()
  }
}

const firePointerDoubleClick = (element: Element, pointerType: 'mouse' | 'touch' | 'pen' = 'mouse') => {
  for (const detail of [1, 2]) {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail })
    Object.defineProperty(click, 'pointerType', { value: pointerType })
    fireEvent(element, click)
  }
  fireEvent(element, new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.macTransparentState.value = false
  mocks.platformState.isMac = false
})

describe('AppShellTabBar', () => {
  const renderTabBar = (
    props?: Partial<ComponentProps<typeof AppShellTabBar>>,
    wrapperProps?: ComponentProps<'div'>
  ) => {
    const closeTab = vi.fn()
    const tabs: Tab[] = props?.tabs ?? [createTab('home'), createTab('a')]

    render(
      <div {...wrapperProps}>
        <AppShellTabBar
          tabs={tabs}
          activeTabId={tabs[0]?.id ?? 'home'}
          setActiveTab={vi.fn()}
          reorderTabs={vi.fn()}
          pinTab={vi.fn()}
          unpinTab={vi.fn()}
          openTab={vi.fn()}
          closeTabs={vi.fn()}
          {...props}
          closeTab={closeTab}
        />
      </div>
    )

    return closeTab
  }
  it('opens launchpad from the plus button', async () => {
    const user = userEvent.setup()
    const openTab = vi.fn()
    const tabs = [createTab('home')]

    renderTabBar({ tabs, activeTabId: 'home', openTab })

    await user.click(screen.getByRole('button', { name: 'Launchpad' }))

    expect(openTab).toHaveBeenCalledWith('/app/launchpad', { title: 'Launchpad', forceNew: true })
  })

  it('shows the focused tab as a Back control with a visible detach action', async () => {
    const user = userEvent.setup()
    const settingsTab = createTab('settings', { url: '/settings/provider', title: 'Settings', isPinned: true })
    const detachTab = vi.fn()

    renderTabBar({
      tabs: [settingsTab],
      activeTabId: settingsTab.id,
      isFocusedTab: true,
      detachTab
    })

    expect(screen.getByRole('button', { name: 'common.back' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Launchpad' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('shell-tab-actions')).not.toBeInTheDocument()
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
    expect(screen.queryByTestId('menu-tab.pin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('menu-tab.move-to-first')).not.toBeInTheDocument()
    expect(screen.queryByTestId('menu-tab.close-others')).not.toBeInTheDocument()
    expect(screen.queryByTestId('menu-tab.close-to-right')).not.toBeInTheDocument()

    const detachButton = screen.getByLabelText('tab.open_in_new_window', { selector: 'button' })
    expect(detachButton).toHaveTextContent('')
    await user.click(detachButton)
    expect(detachTab).toHaveBeenCalledWith(settingsTab.id)
  })

  it('detaches the focused tab when dragged outside the tab bar', () => {
    const originalSetPointerCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const isTabBar = (this as HTMLElement).dataset.ui === 'app.tab-bar'
      return {
        width: isTabBar ? 800 : 160,
        height: isTabBar ? 44 : 30,
        top: 0,
        left: 0,
        right: isTabBar ? 800 : 160,
        bottom: isTabBar ? 44 : 30,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn()
    })

    try {
      const settingsTab = createTab('settings', { url: '/settings/provider', title: 'Settings' })
      const closeTab = renderTabBar({
        tabs: [settingsTab],
        activeTabId: settingsTab.id,
        isFocusedTab: true,
        detachTab: vi.fn()
      })
      const tab = screen.getByRole('button', { name: 'common.back' })
      const pointerDown = new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 20,
        screenX: 100,
        screenY: 20
      })
      Object.defineProperty(pointerDown, 'pointerId', { value: 1 })
      fireEvent(tab, pointerDown)

      const pointerMove = new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        screenX: 100,
        screenY: 100
      })
      Object.defineProperty(pointerMove, 'pointerId', { value: 1 })
      fireEvent(document, pointerMove)

      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'tab.detach',
        expect.objectContaining({ id: settingsTab.id, url: settingsTab.url })
      )
      expect(closeTab).toHaveBeenCalledWith(settingsTab.id)
    } finally {
      if (originalSetPointerCapture) {
        Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
      }
      rectSpy.mockRestore()
    }
  })

  it('positions the detached window when a fast drag drops right after the detaching move', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const isTabBar = (this as HTMLElement).dataset.ui === 'app.tab-bar'
      return {
        width: isTabBar ? 800 : 160,
        height: isTabBar ? 44 : 30,
        top: 0,
        left: 0,
        right: isTabBar ? 800 : 160,
        bottom: isTabBar ? 44 : 30,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    })
    const originalSetPointerCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn()
    })
    const moveWindowSend = vi.fn()
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { send: moveWindowSend } }
    })

    try {
      const settingsTab = createTab('settings', { url: '/settings/provider', title: 'Settings' })
      const closeTab = renderTabBar({
        tabs: [settingsTab],
        activeTabId: settingsTab.id,
        isFocusedTab: true,
        detachTab: vi.fn()
      })
      const tab = screen.getByRole('button', { name: 'common.back' })

      // One detaching pointermove, then the pointer comes up before any further move
      // can issue Tab_MoveWindow — the window must still be positioned and shown.
      const pointerDown = new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 20,
        screenX: 100,
        screenY: 20
      })
      Object.defineProperty(pointerDown, 'pointerId', { value: 1 })
      fireEvent(tab, pointerDown)

      const pointerMove = new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        screenX: 100,
        screenY: 100
      })
      Object.defineProperty(pointerMove, 'pointerId', { value: 1 })

      const pointerUp = new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        screenX: 100,
        screenY: 100
      })
      Object.defineProperty(pointerUp, 'pointerId', { value: 1 })

      // Dispatch both inside one act so React cannot flush the pending
      // setDragState({ mode: 'detach' }) between them — pointerup then sees only
      // the synchronous dragRef.detachedCreated flag, the stale-closure fallback
      // the fix adds (real-world fast drops race the render commit the same way).
      act(() => {
        document.dispatchEvent(pointerMove)
        document.dispatchEvent(pointerUp)
      })

      expect(closeTab).toHaveBeenCalledWith(settingsTab.id)
      expect(moveWindowSend).toHaveBeenCalledWith(
        'tab:move-window',
        expect.objectContaining({ tabId: settingsTab.id, x: -300, y: 80 })
      )
    } finally {
      Reflect.deleteProperty(window, 'electron')
      if (originalSetPointerCapture) {
        Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
      }
      rectSpy.mockRestore()
    }
  })

  it('closes the focused tab immediately from the Back control', () => {
    const settingsTab = createTab('settings', { url: '/settings/provider', title: 'Settings' })
    const closeTab = renderTabBar({
      tabs: [settingsTab],
      activeTabId: settingsTab.id,
      isFocusedTab: true
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }), { detail: 1 })

    expect(closeTab).toHaveBeenCalledWith(settingsTab.id)
  })

  it('moves a normal tab to the first slot', async () => {
    const user = userEvent.setup()
    const reorderTabs = vi.fn()
    const tabs = [createTab('home'), createTab('a'), createTab('b')]

    renderTabBar({ tabs, activeTabId: 'home', reorderTabs })

    const moveButtons = screen.getAllByTestId('menu-tab.move-to-first')
    expect(moveButtons).toHaveLength(3)
    await user.click(moveButtons[2])

    expect(reorderTabs).toHaveBeenCalledWith('normal', 2, 0)
  })

  it('closes the other normal tabs from the context menu, leaving pinned tabs alone', async () => {
    const user = userEvent.setup()
    const closeTabs = vi.fn()
    const tabs = [createTab('a'), createTab('b'), createTab('c'), createTab('p', { isPinned: true })]

    renderTabBar({ tabs, activeTabId: 'a', closeTabs })

    // All four tabs offer the action; the pinned tab renders first in the strip.
    const closeOthersButtons = screen.getAllByTestId('menu-tab.close-others')
    expect(closeOthersButtons).toHaveLength(4)
    await user.click(closeOthersButtons[2])

    expect(closeTabs).toHaveBeenCalledWith(['a', 'c'], 'b')
  })

  it('clears the whole normal zone when batch-closing from a pinned tab', async () => {
    const user = userEvent.setup()
    const closeTabs = vi.fn()
    const tabs = [createTab('a'), createTab('b'), createTab('p', { isPinned: true })]

    renderTabBar({ tabs, activeTabId: 'a', closeTabs })

    // The pinned tab renders first, so its buttons come before the normal tabs'.
    await user.click(screen.getAllByTestId('menu-tab.close-to-right')[0])
    expect(closeTabs).toHaveBeenCalledWith(['a', 'b'], 'p')

    closeTabs.mockClear()
    await user.click(screen.getAllByTestId('menu-tab.close-others')[0])
    expect(closeTabs).toHaveBeenCalledWith(['a', 'b'], 'p')
  })

  it('closes the tabs to the right from the context menu', async () => {
    const user = userEvent.setup()
    const closeTabs = vi.fn()
    const tabs = [createTab('a'), createTab('b'), createTab('c')]

    renderTabBar({ tabs, activeTabId: 'a', closeTabs })

    // The rightmost tab has nothing to its right, so only two tabs offer it.
    const closeToRightButtons = screen.getAllByTestId('menu-tab.close-to-right')
    expect(closeToRightButtons).toHaveLength(2)
    await user.click(closeToRightButtons[0])

    expect(closeTabs).toHaveBeenCalledWith(['b', 'c'], 'a')
  })

  it('lets the home tab expose menu affordances like a normal tab', () => {
    const tabs = [createTab('home'), createTab('a')]

    renderTabBar({ tabs, activeTabId: 'home' })

    expect(screen.queryAllByTestId('menu-tab.move-to-first')).toHaveLength(2)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(2)
  })

  it('keeps tab buttons no-drag while leaving tabbar whitespace draggable', () => {
    const tabs = [createTab('home'), createTab('a'), createTab('p', { isPinned: true })]

    renderTabBar({ tabs, activeTabId: 'a' })

    const tabStrip = screen.getByTestId('app-shell-tab-strip')
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    const normalTab = screen.getByRole('button', { name: 'A' })
    const pinnedTab = screen.getByRole('button', { name: 'P' })

    // Electron drag-region markers keep tabs interactive while whitespace can move the window.
    expect(tabStrip.closest('header')).toHaveAttribute('data-ui', 'app.tab-bar')
    expect(tabStrip).not.toHaveClass('nodrag')
    expect(tabStrip).not.toHaveClass('[-webkit-app-region:no-drag]')
    expect(chatTab).toHaveClass('nodrag')
    expect(normalTab).toHaveClass('nodrag')
    expect(pinnedTab).toHaveClass('nodrag')
  })

  it('does not request ResourceList reveal when switching chat or agent tabs', () => {
    const setActiveTab = vi.fn()
    const tabs = [
      createTab('files', { title: 'Files' }),
      createTab('chat', { url: '/app/chat?topicId=topic-1', title: 'Chat' }),
      createTab('agents', { url: '/app/agents?sessionId=session-1', title: 'Agent' })
    ]

    renderTabBar({ tabs, activeTabId: 'files', setActiveTab })

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(setActiveTab).toHaveBeenCalledWith('chat')
    expect(setActiveTab).toHaveBeenCalledWith('agents')
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
  })

  it('keeps close and pin menu actions when only a single tab is open', () => {
    const tabs = [createTab('home')]

    renderTabBar({ tabs, activeTabId: 'home' })

    expect(screen.queryByTestId('menu-tab.move-to-first')).toBeNull()
    expect(screen.queryAllByTestId('menu-tab.pin')).toHaveLength(1)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(1)
  })

  it('does not offer pinning for transient mini-app tabs', () => {
    const transientMiniAppTab = createTab('mini-app', {
      url: '/app/mini-app/deepseek-harness',
      metadata: { transientMiniApp: true }
    })

    renderTabBar({ tabs: [transientMiniAppTab], activeTabId: transientMiniAppTab.id, detachTab: vi.fn() })

    expect(screen.queryByTestId('menu-tab.pin')).not.toBeInTheDocument()
    expect(screen.getByTestId('menu-tab.open-in-new-window')).toBeInTheDocument()
    expect(screen.getByTestId('menu-tab.close')).toBeInTheDocument()
  })

  it('allows both the last normal tab and pinned tabs to close from the menu', () => {
    const tabs = [createTab('home'), createTab('p', { isPinned: true })]

    renderTabBar({ tabs, activeTabId: 'home' })

    expect(screen.queryAllByTestId('menu-tab.pin')).toHaveLength(2)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(2)
    expect(screen.queryAllByTestId('menu-tab.move-to-first')).toHaveLength(0)
  })

  it('closes a pinned tab through its context menu item', () => {
    const tabs = [createTab('home'), createTab('p', { isPinned: true })]

    const closeTab = renderTabBar({ tabs, activeTabId: 'home' })

    // Pinned zone renders before the normal zone, so index 0 is the pinned tab.
    const closeItems = screen.getAllByTestId('menu-tab.close')
    fireEvent.click(closeItems[0])
    expect(closeTab).toHaveBeenCalledWith('p')
    fireEvent.click(closeItems[1])
    expect(closeTab).toHaveBeenCalledWith('home')
  })

  it('closes a tab from its close button without selecting it', () => {
    const setActiveTab = vi.fn()
    const tabs = [createTab('home'), createTab('a')]

    const closeTab = renderTabBar({ tabs, activeTabId: 'home', setActiveTab })

    const tab = screen.getByRole('button', { name: 'A' })
    const closeOverlay = within(tab).getByRole('button', { name: 'tab.close' })

    fireEvent.click(closeOverlay)
    expect(closeTab).toHaveBeenCalledWith('a')
    expect(setActiveTab).not.toHaveBeenCalled()
  })

  it.each(['touch', 'pen'] as const)(
    'closes a tab immediately for a %s click without freezing the strip',
    (pointerType) => {
      const closeTab = renderTabBar()
      const tab = screen.getByRole('button', { name: 'A' })
      const remainingTab = screen.getByRole('button', { name: 'Chat' })
      const closeButton = within(tab).getByRole('button', { name: 'tab.close' })
      const click = new MouseEvent('click', { bubbles: true, detail: 1 })
      Object.defineProperty(click, 'pointerType', { value: pointerType })

      fireEvent(closeButton, click)

      expect(closeTab).toHaveBeenCalledOnce()
      expect(closeTab).toHaveBeenCalledWith('a')
      expect(tab).toHaveStyle({ flex: '1 1 0px' })
      expect(remainingTab).toHaveStyle({ flex: '1 1 0px' })
    }
  )

  it.each(['touch', 'pen'] as const)(
    'closes a tab immediately for a %s double click without freezing the strip',
    (pointerType) => {
      const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 120,
        height: 30,
        top: 0,
        left: 0,
        right: 120,
        bottom: 30,
        x: 0,
        y: 0,
        toJSON: () => ({})
      } as DOMRect)

      try {
        const closeTab = renderTabBar()
        const tab = screen.getByRole('button', { name: 'A' })
        const remainingTab = screen.getByRole('button', { name: 'Chat' })

        firePointerDoubleClick(tab, pointerType)

        expect(closeTab).toHaveBeenCalledOnce()
        expect(closeTab).toHaveBeenCalledWith('a')
        expect(tab).toHaveStyle({ flex: '1 1 0px' })
        expect(remainingTab).toHaveStyle({ flex: '1 1 0px' })
      } finally {
        rectSpy.mockRestore()
      }
    }
  )

  it('keeps the close button reachable by keyboard', () => {
    const closeTab = renderTabBar()

    const tab = screen.getByRole('button', { name: 'A' })
    const closeButton = within(tab).getByRole('button', { name: 'tab.close' })

    // Hidden via opacity + collapsed width, not display — display:none would drop
    // it from the tab order, and a fixed width would reserve blank space on the tab.
    expect(closeButton).toHaveClass('opacity-0')
    expect(closeButton).toHaveClass('w-0')
    expect(closeButton).not.toHaveClass('hidden')
    expect(closeButton).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(closeButton, { key: 'Enter' })
    expect(closeTab).toHaveBeenCalledWith('a')
  })

  it('always shows the close button on the active tab', () => {
    renderTabBar()

    const activeTab = screen.getByRole('button', { name: 'Chat' })
    const closeButton = within(activeTab).getByRole('button', { name: 'tab.close' })

    expect(closeButton).toHaveClass('opacity-100')
    expect(closeButton).toHaveClass('w-[18px]')
    expect(closeButton).not.toHaveClass('opacity-0')
  })

  it('freezes tab widths, collapses the closed tab, then re-flexes when the mouse leaves the strip', () => {
    const restoreAnimation = mockCloseAnimation()

    try {
      const closeTab = renderTabBar()

      const tabA = screen.getByRole('button', { name: 'A' })
      const closeButton = within(tabA).getByRole('button', { name: 'tab.close' })

      // detail > 0 marks a real mouse click; keyboard-driven closes must not freeze.
      fireEvent.click(closeButton, { detail: 1 })

      // Phase 1: the whole strip freezes instantly (a visual no-op snap).
      const remainingTab = screen.getByRole('button', { name: 'Chat' })
      expect(tabA).toHaveStyle({ flex: '0 0 120px' })
      expect(remainingTab).toHaveStyle({ flex: '0 0 120px' })
      expect(closeTab).not.toHaveBeenCalled()

      // Phase 2 (next frames): the closed tab collapses; removal waits for the end.
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(tabA).toHaveStyle({ flex: '0 0 0px' })
      expect(tabA).toHaveStyle({ opacity: '0' })
      expect(closeTab).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(closeTab).toHaveBeenCalledWith('a')

      // jsdom reports zero-size rects, so the thaw falls back to an instant unfreeze.
      fireEvent.mouseLeave(screen.getByTestId('app-shell-tab-strip'))
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(remainingTab).toHaveStyle({ flex: '1 1 0px' })
    } finally {
      restoreAnimation()
    }
  })

  it('routes the deferred close through the latest closeTab, not the click-time closure', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 120,
      height: 30,
      top: 0,
      left: 0,
      right: 120,
      bottom: 30,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.useFakeTimers()
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16) as unknown as number
    )

    try {
      const staleCloseTab = vi.fn()
      const freshCloseTab = vi.fn()
      const tabs = [createTab('home'), createTab('a')]
      const baseProps = {
        tabs,
        activeTabId: 'home',
        setActiveTab: vi.fn(),
        closeTabs: vi.fn(),
        reorderTabs: vi.fn(),
        pinTab: vi.fn(),
        unpinTab: vi.fn(),
        openTab: vi.fn()
      }

      const { rerender } = render(<AppShellTabBar {...baseProps} closeTab={staleCloseTab} />)

      const tab = screen.getByRole('button', { name: 'A' })
      fireEvent.click(within(tab).getByRole('button', { name: 'tab.close' }), { detail: 1 })

      // The provider hands down a new closeTab (fresh tabs/activeTabId closure)
      // before the 200ms deferral fires — the deferred call must use it, or the
      // provider computes fallback/active decisions against a stale world.
      rerender(<AppShellTabBar {...baseProps} closeTab={freshCloseTab} />)

      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(freshCloseTab).toHaveBeenCalledWith('a')
      expect(staleCloseTab).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      rectSpy.mockRestore()
    }
  })

  it.each([0, 16])('cancels deferred close work when unmounted after %d ms', (elapsedMs) => {
    const restoreAnimation = mockCloseAnimation()

    try {
      const setActiveTab = vi.fn()
      const closeTab = vi.fn()
      const tabs = [createTab('home'), createTab('a')]

      const { unmount } = render(
        <AppShellTabBar
          tabs={tabs}
          activeTabId="home"
          setActiveTab={setActiveTab}
          closeTab={closeTab}
          closeTabs={vi.fn()}
          reorderTabs={vi.fn()}
          pinTab={vi.fn()}
          unpinTab={vi.fn()}
          openTab={vi.fn()}
        />
      )

      const closeButton = within(screen.getByRole('button', { name: 'Chat' })).getByRole('button', {
        name: 'tab.close'
      })
      fireEvent.click(closeButton, { detail: 1 })
      act(() => {
        vi.advanceTimersByTime(elapsedMs)
      })
      unmount()

      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(setActiveTab).not.toHaveBeenCalled()
      expect(closeTab).not.toHaveBeenCalled()
    } finally {
      restoreAnimation()
    }
  })

  it('hands the active slot to the right neighbor as soon as a pointer close starts', () => {
    const restoreAnimation = mockCloseAnimation()

    try {
      const setActiveTab = vi.fn()
      const tabs = [createTab('home'), createTab('a')]

      const closeTab = renderTabBar({ tabs, activeTabId: 'home', setActiveTab })

      const activeTab = screen.getByRole('button', { name: 'Chat' })
      fireEvent.click(within(activeTab).getByRole('button', { name: 'tab.close' }), { detail: 1 })

      // The handover rides the same commit as the collapse start (a couple of
      // frames after the click) — long before the tab is actually removed.
      expect(setActiveTab).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(setActiveTab).toHaveBeenCalledWith('a')
      expect(closeTab).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(closeTab).toHaveBeenCalledWith('home')
    } finally {
      restoreAnimation()
    }
  })

  it('deduplicates a double click on the close button', () => {
    const restoreAnimation = mockCloseAnimation()

    try {
      const setActiveTab = vi.fn()
      const tabs = [createTab('home'), createTab('a')]

      const closeTab = renderTabBar({ tabs, activeTabId: 'home', setActiveTab })

      const closeButton = within(screen.getByRole('button', { name: 'Chat' })).getByRole('button', {
        name: 'tab.close'
      })
      fireEvent.click(closeButton, { detail: 1 })
      fireEvent.click(closeButton, { detail: 2 })
      fireEvent.doubleClick(closeButton, { detail: 2 })

      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(setActiveTab).toHaveBeenCalledTimes(1)
      expect(setActiveTab).toHaveBeenCalledWith('a')
      expect(closeTab).toHaveBeenCalledTimes(1)
      expect(closeTab).toHaveBeenCalledWith('home')
    } finally {
      restoreAnimation()
    }
  })

  it('hands the last normal tab to a pinned survivor before removal', () => {
    const restoreAnimation = mockCloseAnimation()

    try {
      const setActiveTab = vi.fn()
      const tabs = [createTab('p', { isPinned: true }), createTab('a')]

      renderTabBar({ tabs, activeTabId: 'a', setActiveTab })

      const closeButton = within(screen.getByRole('button', { name: 'A' })).getByRole('button', {
        name: 'tab.close'
      })
      fireEvent.click(closeButton, { detail: 1 })
      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(setActiveTab).toHaveBeenCalledTimes(1)
      expect(setActiveTab).toHaveBeenCalledWith('p')
    } finally {
      restoreAnimation()
    }
  })

  it('skips every pending tab when two pointer closes start in the same frame', () => {
    const restoreAnimation = mockCloseAnimation()

    try {
      const setActiveTab = vi.fn()
      const tabs = [createTab('a'), createTab('b'), createTab('c')]

      const closeTab = renderTabBar({ tabs, activeTabId: 'a', setActiveTab })

      for (const title of ['A', 'B']) {
        const closeButton = within(screen.getByRole('button', { name: title })).getByRole('button', {
          name: 'tab.close'
        })
        fireEvent.click(closeButton, { detail: 1 })
      }
      act(() => {
        vi.advanceTimersByTime(50)
      })

      expect(setActiveTab).toHaveBeenCalledTimes(1)
      expect(setActiveTab).toHaveBeenCalledWith('c')

      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(closeTab).toHaveBeenCalledTimes(2)
      expect(closeTab).toHaveBeenCalledWith('a')
      expect(closeTab).toHaveBeenCalledWith('b')
    } finally {
      restoreAnimation()
    }
  })

  it('keeps the strip frozen when the pointer leaves before collapse starts', () => {
    const restoreAnimation = mockCloseAnimation()

    try {
      renderTabBar()

      const closingTab = screen.getByRole('button', { name: 'A' })
      const remainingTab = screen.getByRole('button', { name: 'Chat' })
      fireEvent.click(within(closingTab).getByRole('button', { name: 'tab.close' }), { detail: 1 })
      fireEvent.mouseLeave(screen.getByTestId('app-shell-tab-strip'))

      act(() => {
        vi.advanceTimersByTime(20)
      })
      expect(closingTab).toHaveStyle({ flex: '0 0 120px' })
      expect(remainingTab).toHaveStyle({ flex: '0 0 120px' })

      act(() => {
        vi.advanceTimersByTime(30)
      })
      expect(closingTab).toHaveStyle({ flex: '0 0 0px' })
    } finally {
      restoreAnimation()
    }
  })

  it('includes a leading closing tab gap and current margin in the early thaw target', () => {
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const element = this as HTMLElement
      const tabId = element.dataset.tabId
      const geometry =
        element.dataset.testid === 'app-shell-tab-strip'
          ? { left: 0, width: 300 }
          : tabId === 'a'
            ? { left: 0, width: 90 }
            : tabId === 'b'
              ? { left: 94, width: 90 }
              : tabId === 'c'
                ? { left: 188, width: 90 }
                : { left: 0, width: 0 }
      return {
        width: geometry.width,
        height: 30,
        top: 0,
        left: geometry.left,
        right: geometry.left + geometry.width,
        bottom: 30,
        x: geometry.left,
        y: 0,
        toJSON: () => ({})
      } as DOMRect
    })
    vi.useFakeTimers()
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16) as unknown as number
    )

    try {
      renderTabBar({
        tabs: [createTab('a'), createTab('b'), createTab('c')]
      })
      const closingTab = screen.getByRole('button', { name: 'A' })
      const remainingTab = screen.getByRole('button', { name: 'B' })

      fireEvent.click(within(closingTab).getByRole('button', { name: 'tab.close' }), { detail: 1 })
      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(closingTab).toHaveStyle({ flex: '0 0 0px' })

      // Model the first transition frame: width is still 90px and margin-right
      // is still 0px, so the leading item's full footprint is 90 + gap 4.
      const styleSpy = vi
        .spyOn(window, 'getComputedStyle')
        .mockReturnValue({ marginRight: '0px' } as CSSStyleDeclaration)
      try {
        fireEvent.mouseLeave(screen.getByTestId('app-shell-tab-strip'))
        expect(styleSpy).toHaveBeenCalled()
      } finally {
        styleSpy.mockRestore()
      }

      // Strip right limit: 300 - pr-1 4 - launchpad footprint 6 = 290.
      // (290 - post-close left 0 - alive gap 4) / 2 = 143.
      expect(remainingTab).toHaveStyle({ flex: '0 0 143px' })
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      rectSpy.mockRestore()
    }
  })

  it('divides adjacent normal tabs, skipping the first tab and every lit neighbor', () => {
    const tabs = [createTab('a'), createTab('b'), createTab('c'), createTab('d')]

    renderTabBar({ tabs, activeTabId: 'c' })

    const hasDivider = (name: string) =>
      screen.getByRole('button', { name }).querySelector('[data-tab-divider][data-visible]') !== null

    // "A" opens the strip; "C" is active, so both boundaries around it stay clear.
    expect(hasDivider('A')).toBe(false)
    expect(hasDivider('B')).toBe(true)
    expect(hasDivider('C')).toBe(false)
    expect(hasDivider('D')).toBe(false)
  })

  it('keeps the divider at Chrome-matched metrics', () => {
    renderTabBar({ tabs: [createTab('a'), createTab('b'), createTab('c')], activeTabId: 'a' })

    // The tint/thickness were calibrated against a Chrome screenshot; pin them so
    // a later "tidy-up" cannot silently wash the divider out again.
    const divider = screen.getByRole('button', { name: 'C' }).querySelector('[data-tab-divider]')
    expect(divider).toHaveClass('h-4', 'w-[1.5px]', 'bg-border/80')
    // It fades on the same 150ms as the tab tint it hands the boundary over to.
    expect(divider).toHaveClass('transition-opacity', 'duration-150')
  })

  it('drops every divider while a reorder drag is in flight', () => {
    const originalSetPointerCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })

    try {
      const tabs = [createTab('a'), createTab('b'), createTab('c'), createTab('d')]
      renderTabBar({ tabs, activeTabId: 'a' })

      const hasDivider = (name: string) =>
        screen.getByRole('button', { name }).querySelector('[data-tab-divider][data-visible]') !== null
      expect(hasDivider('C')).toBe(true)

      // Dragging only translates tabs — the arrays keep their pre-drop order, so a
      // divider drawn from that order can land against the dragged tab.
      const dragged = screen.getByRole('button', { name: 'D' })
      const pointerDown = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 300, clientY: 20 })
      Object.defineProperty(pointerDown, 'pointerId', { value: 1 })
      fireEvent(dragged, pointerDown)
      const pointerMove = new MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 20 })
      Object.defineProperty(pointerMove, 'pointerId', { value: 1 })
      fireEvent(document, pointerMove)

      expect(dragged).toHaveClass('cursor-grabbing')
      expect(document.querySelectorAll('[data-tab-divider][data-visible]')).toHaveLength(0)
    } finally {
      if (originalSetPointerCapture) {
        Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture)
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
      }
    }
  })

  it('clears the divider beside a tab whose context menu is open', () => {
    const tabs = [createTab('a'), createTab('b'), createTab('c')]
    renderTabBar({ tabs, activeTabId: 'a' })

    const hasDivider = (name: string) =>
      screen.getByRole('button', { name }).querySelector('[data-tab-divider][data-visible]') !== null
    expect(hasDivider('C')).toBe(true)

    // A menu-open tab is tinted like a hovered one, and the modal menu steals the
    // pointer — so hover state alone cannot keep the neighbouring divider away.
    fireEvent.click(screen.getAllByTestId('menu-set-open')[1])
    expect(hasDivider('B')).toBe(false)
    expect(hasDivider('C')).toBe(false)

    fireEvent.click(screen.getAllByTestId('menu-set-closed')[1])
    expect(hasDivider('C')).toBe(true)
  })

  it('clears the divider beside a collapsing tab, and the zone separator beside a lit tab', () => {
    const restore = mockCloseAnimation()

    try {
      const tabs = [createTab('p', { isPinned: true }), createTab('a'), createTab('b'), createTab('c')]
      renderTabBar({ tabs, activeTabId: 'a' })

      const hasDivider = (name: string) =>
        screen.getByRole('button', { name }).querySelector('[data-tab-divider][data-visible]') !== null
      // The pinned zone already ends in its own separator, so the first normal tab
      // must not add one on top of it.
      expect(hasDivider('A')).toBe(false)
      expect(hasDivider('C')).toBe(true)

      const closeButton = within(screen.getByRole('button', { name: 'B' })).getByRole('button', { name: 'tab.close' })
      // detail: 1 marks it a real pointer close — the path that plays the collapse.
      fireEvent.click(closeButton, { detail: 1 })
      act(() => {
        vi.advanceTimersByTime(40)
      })

      // "B" is collapsing: its own divider and the one on "C" must stay away until
      // it is gone, or a hairline flashes in the shrinking gap.
      expect(hasDivider('B')).toBe(false)
      expect(hasDivider('C')).toBe(false)
    } finally {
      restore()
    }
  })

  it('clears the dividers on both sides of the hovered tab', async () => {
    const user = userEvent.setup()
    const tabs = [createTab('a'), createTab('b'), createTab('c')]

    renderTabBar({ tabs, activeTabId: 'a' })

    const hasDivider = (name: string) =>
      screen.getByRole('button', { name }).querySelector('[data-tab-divider][data-visible]') !== null

    expect(hasDivider('C')).toBe(true)

    await user.hover(screen.getByRole('button', { name: 'B' }))
    expect(hasDivider('B')).toBe(false)
    expect(hasDivider('C')).toBe(false)

    await user.unhover(screen.getByRole('button', { name: 'B' }))
    expect(hasDivider('C')).toBe(true)
  })

  it('keeps the tab highlighted while its context menu is open', () => {
    renderTabBar()

    const tab = () => screen.getByRole('button', { name: 'A' })
    expect(tab()).not.toHaveAttribute('data-menu-open')

    // One toggle pair per tab menu; index 1 belongs to tab "A".
    fireEvent.click(screen.getAllByTestId('menu-set-open')[1])
    expect(tab()).toHaveAttribute('data-menu-open', 'true')

    fireEvent.click(screen.getAllByTestId('menu-set-closed')[1])
    expect(tab()).not.toHaveAttribute('data-menu-open')
  })

  it('allows closing normal tabs while more than one normal tab is open', () => {
    const tabs = [createTab('home'), createTab('a'), createTab('p', { isPinned: true })]

    renderTabBar({ tabs, activeTabId: 'home' })

    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(3)
  })
  it('closes a normal tab on double click or middle click', () => {
    const handleDoubleClick = vi.fn()
    const handleAuxClick = vi.fn()
    const closeTab = renderTabBar(undefined, {
      onDoubleClick: handleDoubleClick,
      onAuxClick: handleAuxClick
    })
    const tabA = screen.getByRole('button', { name: 'A' })

    firePointerDoubleClick(tabA)
    expect(closeTab).toHaveBeenCalledWith('a')
    expect(handleDoubleClick).not.toHaveBeenCalled()

    closeTab.mockClear()
    const middleClick = new MouseEvent('auxclick', {
      button: 1,
      bubbles: true,
      cancelable: true
    })
    fireEvent(tabA, middleClick)
    expect(closeTab).toHaveBeenCalledWith('a')
    expect(middleClick.defaultPrevented).toBe(true)
    expect(handleAuxClick).not.toHaveBeenCalled()
  })

  it('closes a single normal tab on double click or middle click', () => {
    const handleDoubleClick = vi.fn()
    const handleAuxClick = vi.fn()
    const closeTab = renderTabBar(
      {
        tabs: [createTab('a')],
        activeTabId: 'a'
      },
      {
        onDoubleClick: handleDoubleClick,
        onAuxClick: handleAuxClick
      }
    )
    const tabA = screen.getByRole('button', { name: 'A' })

    firePointerDoubleClick(tabA)

    const middleClick = new MouseEvent('auxclick', {
      button: 1,
      bubbles: true,
      cancelable: true
    })
    fireEvent(tabA, middleClick)

    expect(closeTab).toHaveBeenCalledWith('a')
    expect(closeTab).toHaveBeenCalledTimes(2)
    expect(middleClick.defaultPrevented).toBe(true)
    expect(handleDoubleClick).not.toHaveBeenCalled()
    expect(handleAuxClick).not.toHaveBeenCalled()
  })
})

describe('getTabCapabilities', () => {
  const ctx = (
    over?: Partial<{ pinnedCount: number; normalCount: number; canDetach: boolean; normalIndex: number }>
  ) => ({
    pinnedCount: 1,
    normalCount: 1,
    canDetach: true,
    ...over
  })

  it('keeps close, pin, detach, and menu enabled for the last normal tab', () => {
    expect(getTabCapabilities({ id: 'home', isPinned: false }, ctx({ normalCount: 1, normalIndex: 0 }))).toEqual({
      menu: true,
      reorder: false,
      togglePin: true,
      detach: true,
      close: true,
      closeOthers: false,
      closeToRight: false
    })
  })

  it('unlocks every normal action once a second normal tab exists', () => {
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 2, normalIndex: 0 }))).toEqual({
      menu: true,
      reorder: true,
      togglePin: true,
      detach: true,
      close: true,
      closeOthers: true,
      closeToRight: true
    })
  })

  it('does not treat newly-created chat tabs as the fixed home tab', () => {
    expect(getTabCapabilities({ id: 'chat', isPinned: false }, ctx({ normalCount: 2, normalIndex: 1 }))).toEqual({
      menu: true,
      reorder: true,
      togglePin: true,
      detach: true,
      close: true,
      closeOthers: true,
      closeToRight: false
    })
  })

  it('treats the home tab like any other normal tab when siblings exist', () => {
    expect(getTabCapabilities({ id: 'home', isPinned: false }, ctx({ normalCount: 3, normalIndex: 0 }))).toEqual({
      menu: true,
      reorder: true,
      togglePin: true,
      detach: true,
      close: true,
      closeOthers: true,
      closeToRight: true
    })
  })

  it('lets pinned tabs unpin and close via menu, batch-closing only the normal zone', () => {
    expect(getTabCapabilities({ id: 'p', isPinned: true }, ctx({ pinnedCount: 1, normalCount: 1 }))).toEqual({
      menu: true,
      reorder: false,
      togglePin: true,
      detach: true,
      close: true,
      closeOthers: true,
      closeToRight: true
    })
    expect(getTabCapabilities({ id: 'p', isPinned: true }, ctx({ pinnedCount: 2 })).reorder).toBe(true)
  })

  it('hides batch close on pinned tabs when no normal tabs exist', () => {
    const caps = getTabCapabilities({ id: 'p', isPinned: true }, ctx({ pinnedCount: 2, normalCount: 0 }))
    expect(caps.close).toBe(true)
    expect(caps.closeOthers).toBe(false)
    expect(caps.closeToRight).toBe(false)
  })

  it('offers close-to-right only while normal tabs exist to the right', () => {
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 3, normalIndex: 1 })).closeToRight).toBe(
      true
    )
    expect(getTabCapabilities({ id: 'c', isPinned: false }, ctx({ normalCount: 3, normalIndex: 2 })).closeToRight).toBe(
      false
    )
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 3 })).closeToRight).toBe(false)
  })

  it('respects window detach support', () => {
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 2 })).detach).toBe(true)
    expect(getTabCapabilities({ id: 'p', isPinned: true }, ctx({ pinnedCount: 2 })).detach).toBe(true)
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 2, canDetach: false })).detach).toBe(
      false
    )
  })

  it('disables pinning for transient mini-app tabs', () => {
    const transientMiniAppTab = createTab('mini-app', { metadata: { transientMiniApp: true } })

    expect(getTabCapabilities(transientMiniAppTab, ctx({ normalIndex: 0 })).togglePin).toBe(false)
  })
})
