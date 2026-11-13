// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as UI from '@cherrystudio/ui'
import { useTabsContext } from '@renderer/hooks/tab'

import { TabsProvider } from '../TabsProvider'

const mocks = vi.hoisted(() => ({
  emojiIconProps: [] as Array<{ emoji: string; size?: number; fontSize?: number; className?: string }>,
  emitResourceListReveal: vi.fn(),
  ipcRequest: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  macTransparentState: { value: false },
  platformState: { isMac: false, isWin: false },
  showSearchPopup: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/components/AgentBrowserRuntimeHost', () => ({ AgentBrowserRuntimeHost: () => null }))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('@renderer/services/resourceListRevealEvents', () => ({
  emitResourceListReveal: mocks.emitResourceListReveal
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  Kbd: (await importOriginal<typeof UI>()).Kbd,
  Button: ({ children, variant, ...props }: React.ComponentProps<'button'> & { variant?: string }) => {
    void variant
    return (
      <button type={props.type ?? 'button'} {...props}>
        {children}
      </button>
    )
  },
  EmojiIcon: (props: { emoji: string; size?: number; fontSize?: number; className?: string }) => {
    mocks.emojiIconProps.push(props)
    return <span data-testid="emoji-tab-icon">{props.emoji}</span>
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
  get isWin() {
    return mocks.platformState.isWin
  },
  platform: 'linux'
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => ({
  getMiniAppsLogoRef: (logo?: string) => (logo === 'google' ? {} : undefined),
  useMiniAppLogo: (logo?: string) => {
    if (logo !== 'google') return undefined

    return Object.assign(() => null, {
      Avatar: ({ size, shape }: { size: number; shape: string }) => (
        <span data-testid="preset-mini-app-avatar" data-shape={shape} style={{ width: size, height: size }} />
      )
    })
  }
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

vi.mock('../ShellTabBarActions', () => ({
  ShellTabBarActions: () => <div data-testid="shell-tab-actions" />
}))

vi.mock('../../WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => (key === 'title.launchpad' ? 'Launchpad' : key),
    i18n: { language: 'en' }
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
  })
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16))
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
  MockUseCacheUtils.resetMocks()
  vi.clearAllMocks()
  mocks.emojiIconProps.length = 0
  mocks.macTransparentState.value = false
  mocks.platformState.isMac = false
  mocks.platformState.isWin = false
  Reflect.deleteProperty(navigator, 'windowControlsOverlay')
  vi.unstubAllGlobals()
})

describe('AppShellTabBar', () => {
  it('does not mount a separate notification entry in the focused settings tab bar', () => {
    renderTabBar({
      tabs: [createTab('settings', { url: '/settings/notifications' })],
      activeTabId: 'settings',
      isFocusedTab: true
    })
    expect(screen.queryByRole('button', { name: 'Notification center' })).not.toBeInTheDocument()
  })
  it('keeps the Windows title bar at least as tall as the native overlay when zoomed out', () => {
    mocks.platformState.isWin = true
    renderTabBar({ tabs: [createTab('home')], activeTabId: 'home' })
    expect(document.querySelector<HTMLElement>('[data-ui="app.tab-bar"]')?.style.minHeight).toBe(
      'env(titlebar-area-height, 0px)'
    )
  })

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

  it('keeps the macOS leading inset fixed through native resize and refreshes it for zoom and fullscreen', () => {
    mocks.platformState.isMac = true
    vi.stubGlobal('innerWidth', 1226)
    vi.stubGlobal('devicePixelRatio', 2)
    let rect = { x: 86, width: 1140, height: 42 }
    const overlay = Object.assign(document.createElement('div'), { visible: true, getTitlebarAreaRect: () => rect })
    Object.defineProperty(navigator, 'windowControlsOverlay', { configurable: true, value: overlay })
    renderTabBar({ isFocusedTab: true })
    const header = document.querySelector<HTMLElement>('[data-ui~="app.tab-bar"]')!
    // The native-controls inset must not follow transient x offsets or fractional-zoom width rounding.
    expect(header.style.paddingLeft).toBe('calc(88px)')

    const changeGeometry = (width: number, next: typeof rect) => {
      vi.stubGlobal('innerWidth', width)
      rect = next
      fireEvent(overlay, new Event('geometrychange'))
    }
    changeGeometry(1218, { x: 82, width: 1132, height: 42 })
    expect(header.style.paddingLeft).toBe('calc(88px)')

    vi.stubGlobal('devicePixelRatio', 2.5)
    changeGeometry(981, { x: 69, width: 912, height: 34 })
    expect(header.style.paddingLeft).toBe('calc(71px)')
    changeGeometry(974, { x: 66, width: 906, height: 34 })
    expect(header.style.paddingLeft).toBe('calc(71px)')

    overlay.visible = false
    changeGeometry(3440, { x: 0, width: 0, height: 0 })
    expect(header.style.paddingLeft).toBe('calc(71px)')

    overlay.visible = true
    vi.stubGlobal('devicePixelRatio', 2)
    changeGeometry(3440, { x: 86, width: 1103, height: 42 })
    expect(header.style.paddingLeft).toBe('calc(71px)')
    vi.stubGlobal('innerWidth', 1189)
    fireEvent(window, new Event('resize'))
    expect(header.style.paddingLeft).toBe('calc(88px)')
  })

  it('shows supplied hints on pinned and normal tabs without changing their accessible names', () => {
    renderTabBar({
      tabs: [createTab('p', { isPinned: true }), createTab('a')],
      shortcutHints: new Map([
        ['p', '⌃1'],
        ['a', '⌃2']
      ])
    })
    expect(within(screen.getByRole('button', { name: 'P' })).getByText('⌃1')).toBeVisible()
    expect(within(screen.getByRole('button', { name: 'A' })).getByText('⌃2')).toBeVisible()
  })

  it('keeps the account avatar out of the tab bar when the sidebar is hidden', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.sidebar.width', 0)
    renderTabBar({ tabs: [createTab('home')] })

    expect(screen.queryByRole('button', { name: 'sidebar.account_menu' })).not.toBeInTheDocument()
    expect(screen.getByTestId('app-shell-tab-strip').querySelector('[data-tab-id="home"]')).toBeVisible()
  })

  it('names an icon-only pinned tab after its title, not its emoji', () => {
    const emojiTab = createTab('emoji', { icon: 'emoji:🎉', isPinned: true, title: 'Emoji' })

    renderTabBar({ tabs: [emojiTab], activeTabId: emojiTab.id })

    expect(screen.getByRole('button', { name: 'Emoji' })).toHaveAttribute('title', 'Emoji')
  })

  it('appends a fresh launchpad from the plus button while a middle tab is active', async () => {
    const user = userEvent.setup()
    MockUseCacheUtils.setPersistCacheValue('ui.tab.normal_tabs', [createTab('home'), createTab('a'), createTab('b')])
    MockUseCacheUtils.setPersistCacheValue('ui.tab.active_tab_id', 'a')
    function TabBar() {
      return <AppShellTabBar {...useTabsContext()} />
    }
    const { result } = renderHook(useTabsContext, {
      wrapper: ({ children }) => (
        <TabsProvider>
          {children}
          <TabBar />
        </TabsProvider>
      )
    })

    for (const count of [4, 5]) {
      act(() => result.current.setActiveTab('a'))
      await user.click(screen.getByRole('button', { name: 'Launchpad' }))

      expect(result.current.tabs).toHaveLength(count)
      expect(result.current.tabs.slice(0, 3).map((tab) => tab.id)).toEqual(['home', 'a', 'b'])
      expect(result.current.tabs.at(-1)?.url).toBe('/app/launchpad')
      expect(result.current.activeTabId).toBe(result.current.tabs.at(-1)?.id)
    }
  })

  // Protect the persistent selected-tab indicator across selection and pointer closing.
  describe.each([false, true])('selected indicator (transparent macOS: %s)', (transparent) => {
    const normalTabs = [
      createTab('alpha', { title: 'Conversation Alpha', url: '/app/chat?topicId=alpha' }),
      createTab('beta', { title: 'Conversation Beta', url: '/app/chat?topicId=beta' })
    ]
    const pinnedTab = createTab('pinned', {
      title: 'Pinned conversation',
      url: '/app/chat?topicId=pinned',
      isPinned: true
    })

    const renderProvider = (includePinned = false) => {
      mocks.macTransparentState.value = transparent
      MockUseCacheUtils.setPersistCacheValue('ui.tab.normal_tabs', normalTabs)
      MockUseCacheUtils.setPersistCacheValue('ui.tab.pinned_tabs', includePinned ? [pinnedTab] : [])
      MockUseCacheUtils.setPersistCacheValue('ui.tab.active_tab_id', 'alpha')
      function TabBar() {
        return <AppShellTabBar {...useTabsContext()} />
      }
      return renderHook(useTabsContext, {
        wrapper: ({ children }) => (
          <TabsProvider>
            {children}
            <TabBar />
          </TabsProvider>
        )
      })
    }
    const button = (tab: Tab) => screen.getByRole('button', { name: tab.title })
    const expectIndicator = (tab: Tab, selected: boolean) => {
      const outer = button(tab)
      expect(outer).toHaveAttribute('data-tab-id', tab.id)
      // Pending closes retain their visual selection while navigation moves to the survivor.
      if (selected) expect(outer).toHaveAttribute('data-active', 'true')
      else expect(outer).not.toHaveAttribute('data-active')
    }

    it('transfers selection ownership between normal and pinned conversation tabs', () => {
      const { result } = renderProvider(true)
      for (const selected of [normalTabs[0], normalTabs[1], pinnedTab, normalTabs[0]]) {
        fireEvent.click(button(selected))
        expect(result.current.activeTabId).toBe(selected.id)
        for (const tab of [...normalTabs, pinnedTab]) expectIndicator(tab, tab.id === selected.id)
      }
    })

    it('keeps an active pointer-closing tab selected through handover and removal', () => {
      const restoreAnimation = mockCloseAnimation()
      try {
        const { result } = renderProvider()
        const [departing, survivor] = normalTabs
        fireEvent.click(within(button(departing)).getByRole('button', { name: 'tab.close' }), { detail: 1 })
        expectIndicator(departing, true)
        expectIndicator(survivor, false)
        act(() => {
          vi.advanceTimersByTime(32)
        })
        expect(result.current.activeTabId).toBe(survivor.id)
        expectIndicator(departing, true)
        expectIndicator(survivor, true)
        act(() => {
          vi.advanceTimersByTime(200)
        })
        expect(screen.queryByRole('button', { name: departing.title })).not.toBeInTheDocument()
        expectIndicator(survivor, true)
      } finally {
        cleanup()
        restoreAnimation()
      }
    })

    it('never upgrades an inactive pointer-closing tab to the selected indicator', () => {
      const restoreAnimation = mockCloseAnimation()
      try {
        renderProvider()
        const [active, departing] = normalTabs
        fireEvent.mouseEnter(button(departing))
        fireEvent.click(within(button(departing)).getByRole('button', { name: 'tab.close' }), { detail: 1 })
        expectIndicator(departing, false)
        expectIndicator(active, true)
        act(() => {
          vi.advanceTimersByTime(32)
        })
        expectIndicator(departing, false)
        expectIndicator(active, true)
        expect(button(departing)).toHaveAttribute('data-hovered', 'true')
        act(() => {
          vi.advanceTimersByTime(200)
        })
        expect(screen.queryByRole('button', { name: departing.title })).not.toBeInTheDocument()
        expectIndicator(active, true)
      } finally {
        cleanup()
        restoreAnimation()
      }
    })
  })

  it('renders preset and installed mini app icons at the same circular size', () => {
    const presetMiniAppTab = createTab('preset-mini-app', {
      url: '/app/mini-app/google',
      title: 'Preset Mini App',
      icon: 'google'
    })
    const miniAppTab = createTab('installed-mini-app', {
      url: '/app/mini-app/com.example.installed',
      title: 'Installed Mini App',
      icon: 'file:///files/installed.webp'
    })

    renderTabBar({ tabs: [presetMiniAppTab, miniAppTab], activeTabId: miniAppTab.id })

    const presetIcon = screen.getByTestId('preset-mini-app-avatar')
    const tab = screen.getByRole('button', { name: 'Installed Mini App' })
    const image = tab.querySelector('img')
    expect(presetIcon).toHaveAttribute('data-shape', 'circle')
    expect(presetIcon).toHaveStyle({ width: '18px', height: '18px' })
    expect(image).toHaveClass('rounded-full', 'object-cover')
    expect(image).toHaveStyle({ width: '18px', height: '18px' })
    expect(image?.style.backgroundColor).toBe('')
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

    const detachButton = screen.getByLabelText('tab.open_in_new_window', { selector: 'button' })
    await user.click(detachButton)
    expect(detachTab).toHaveBeenCalledWith(settingsTab.id)
  })

  it.each(['success', 'failure'])(
    'handles drag detach %s without losing the source or retrying a failed gesture',
    async (outcome) => {
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
        }
      })
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        configurable: true,
        value: vi.fn()
      })

      let accept!: () => void
      let reject!: (error: Error) => void
      mocks.ipcRequest.mockReturnValueOnce(
        new Promise<void>((resolve, fail) => {
          accept = resolve
          reject = fail
        })
      )
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
        expect(closeTab).not.toHaveBeenCalled()
        if (outcome === 'success') {
          await act(async () => accept())
          expect(closeTab).toHaveBeenCalledWith(settingsTab.id)
        } else {
          await act(async () => reject(new Error('window creation failed')))
          fireEvent(document, pointerMove)
          expect(mocks.ipcRequest).toHaveBeenCalledTimes(1)
          expect(closeTab).not.toHaveBeenCalled()
          expect(screen.getByRole('button', { name: 'common.back' })).toBeVisible()
        }
      } finally {
        if (originalSetPointerCapture) {
          Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalSetPointerCapture)
        } else {
          Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
        }
        rectSpy.mockRestore()
      }
    }
  )

  it('positions a fast-dropped window without closing its source before main-process delivery', async () => {
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
      }
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

    let accept!: () => void
    mocks.ipcRequest.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        accept = resolve
      })
    )
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

      expect(closeTab).not.toHaveBeenCalled()
      await act(async () => accept())
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

      const closeButton = within(tab).getByRole('button', { name: 'tab.close' })
      const click = new MouseEvent('click', { bubbles: true, detail: 1 })
      Object.defineProperty(click, 'pointerType', { value: pointerType })

      fireEvent(closeButton, click)

      expect(closeTab).toHaveBeenCalledOnce()
      expect(closeTab).toHaveBeenCalledWith('a')
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
      })

      try {
        const closeTab = renderTabBar()
        const tab = screen.getByRole('button', { name: 'A' })

        firePointerDoubleClick(tab, pointerType)

        expect(closeTab).toHaveBeenCalledOnce()
        expect(closeTab).toHaveBeenCalledWith('a')
      } finally {
        rectSpy.mockRestore()
      }
    }
  )

  it('keeps the close button reachable by keyboard', () => {
    const closeTab = renderTabBar()

    const tab = screen.getByRole('button', { name: 'A' })
    const closeButton = within(tab).getByRole('button', { name: 'tab.close' })
    expect(closeButton).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(closeButton, { key: 'Enter' })
    expect(closeTab).toHaveBeenCalledWith('a')
  })

  it('defers mouse-driven close until its animation completes', () => {
    const restoreAnimation = mockCloseAnimation()

    try {
      const closeTab = renderTabBar()

      const tabA = screen.getByRole('button', { name: 'A' })
      const closeButton = within(tabA).getByRole('button', { name: 'tab.close' })

      // detail > 0 marks a real mouse click; keyboard-driven closes must not freeze.
      fireEvent.click(closeButton, { detail: 1 })

      expect(closeTab).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(50)
      })
      expect(closeTab).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(closeTab).toHaveBeenCalledWith('a')
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
    })
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16))

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
