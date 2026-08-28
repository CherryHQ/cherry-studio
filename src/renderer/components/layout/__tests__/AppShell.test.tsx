// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { MIN_WINDOW_HEIGHT, SECOND_MIN_WINDOW_WIDTH } from '@shared/utils/window'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeTab: vi.fn(),
  closeTabs: vi.fn(),
  detachTab: vi.fn(),
  setActiveTab: vi.fn(),
  commandHandlers: new Map<string, { handler: () => void; options?: { enabled?: boolean } }>(),
  ipcHandlers: new Map<string, (value: unknown) => void>(),
  ipcRequest: vi.fn(() => Promise.resolve(false)),
  activeTabId: 'home',
  platformState: { isMac: false },
  tabs: [
    {
      id: 'home',
      isDormant: false,
      title: 'Chat',
      type: 'route' as const,
      url: '/app/chat'
    }
  ],
  tabBarProps: undefined as Record<string, unknown> | undefined,
  showSearchPopup: vi.fn(),
  hideSearchPopup: vi.fn()
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return mocks.platformState.isMac
  }
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void, options?: { enabled?: boolean }) => {
    mocks.commandHandlers.set(command, { handler, options })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.ipcRequest
  },
  useIpcOn: (event: string, handler: (value: unknown) => void) => {
    mocks.ipcHandlers.set(event, handler)
  }
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup,
    hide: mocks.hideSearchPopup
  }
}))

vi.mock('../../../hooks/tab', () => ({
  useMainWindowNavigation: vi.fn(),
  useTabs: () => ({
    activeTabId: mocks.activeTabId,
    closeTab: mocks.closeTab,
    closeTabs: mocks.closeTabs,
    detachTab: mocks.detachTab,
    openTab: vi.fn(),
    pinTab: vi.fn(),
    reorderTabs: vi.fn(),
    setActiveTab: mocks.setActiveTab,
    tabs: mocks.tabs,
    unpinTab: vi.fn(),
    updateTab: vi.fn()
  })
}))

vi.mock('../../app/Sidebar', () => ({
  default: () => <aside data-testid="sidebar" />
}))

vi.mock('../../GlobalSearch/globalSearchGroups', () => ({
  createRecentRouteEntryFromTab: () => null,
  upsertGlobalSearchRecentEntry: (items: unknown[]) => items
}))

vi.mock('../../MiniApp/MiniAppTabsPool', () => ({
  default: () => <div data-testid="mini-app-pool" />
}))

vi.mock('../../ResourceViewSourceProvider', () => ({
  ResourceViewSourceProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="resource-view-source-provider">{children}</div>
  )
}))

vi.mock('../AppShellTabBar', () => ({
  AppShellTabBar: (props: Record<string, unknown>) => {
    mocks.tabBarProps = props
    return <header data-testid="tab-bar" />
  }
}))

vi.mock('../TabRouter', () => ({
  TabRouter: ({ tab }: { tab: { id: string } }) => <section data-testid="tab-router" data-tab-id={tab.id} />
}))

import { AppShell } from '../AppShell'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  MockUseCacheUtils.resetMocks()
  mocks.commandHandlers.clear()
  mocks.ipcHandlers.clear()
  mocks.ipcRequest.mockResolvedValue(false)
  mocks.activeTabId = 'home'
  mocks.platformState.isMac = false
  mocks.tabs = [
    {
      id: 'home',
      isDormant: false,
      title: 'Chat',
      type: 'route',
      url: '/app/chat'
    }
  ]
  mocks.tabBarProps = undefined
})

describe('AppShell', () => {
  it('owns the resource source provider at the route host boundary', () => {
    render(<AppShell />)

    const provider = screen.getByTestId('resource-view-source-provider')

    expect(provider).toContainElement(screen.getByTestId('tab-router'))
    expect(provider).not.toContainElement(screen.getByTestId('mini-app-pool'))
    expect(provider).not.toContainElement(screen.getByTestId('sidebar'))
    expect(provider).not.toContainElement(screen.getByTestId('tab-bar'))
  })

  it('applies the compact minimum window size for the active chat tab and resets it on leaving', async () => {
    mocks.tabs = [
      ...mocks.tabs,
      {
        id: 'agents',
        isDormant: false,
        title: 'Agents',
        type: 'route',
        url: '/app/agents'
      },
      {
        id: 'files',
        isDormant: false,
        title: 'Files',
        type: 'route',
        url: '/app/files'
      }
    ]

    const { rerender } = render(<AppShell />)

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('window.main.set_minimum_size', {
        width: SECOND_MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT
      })
    })
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('window.main.reset_minimum_size')

    // Switching between two compact tabs must not re-issue the IPC pair.
    mocks.ipcRequest.mockClear()
    mocks.activeTabId = 'agents'
    rerender(<AppShell />)
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('window.main.set_minimum_size', expect.anything())

    mocks.activeTabId = 'files'
    rerender(<AppShell />)
    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('window.main.reset_minimum_size')
    })
  })

  it('opens global search from the shell-level shortcut', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.handler()

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('focuses the active Settings tab and hides workspace navigation', () => {
    const settingsTab = {
      id: 'settings',
      isDormant: false,
      title: 'Settings',
      type: 'route' as const,
      url: '/settings/provider'
    }
    mocks.tabs = [...mocks.tabs, settingsTab]
    mocks.activeTabId = settingsTab.id

    render(<AppShell />)

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
    expect(mocks.tabBarProps).toMatchObject({
      activeTabId: settingsTab.id,
      isFocusedTab: true,
      tabs: [settingsTab]
    })
    expect(screen.getAllByTestId('tab-router').map((router) => router.dataset.tabId)).toEqual(['home', 'settings'])
  })

  it('keeps a background Settings tab in the positional tab-bar list', () => {
    mocks.tabs = [
      ...mocks.tabs,
      {
        id: 'settings',
        isDormant: false,
        title: 'Settings',
        type: 'route',
        url: '/settings/provider'
      },
      {
        id: 'files',
        isDormant: false,
        title: 'Files',
        type: 'route',
        url: '/app/files'
      }
    ]
    mocks.activeTabId = 'files'

    render(<AppShell />)

    // AppShellTabBar sends positional reorder indices to TabsProvider, so this list must stay unfiltered.
    const tabBarTabs = mocks.tabBarProps?.tabs as Array<{ id: string }> | undefined
    expect(tabBarTabs?.map((tab) => tab.id)).toEqual(['home', 'settings', 'files'])
  })

  it('restores the tab that was active before Settings when the focused tab closes or detaches', () => {
    const workspaceTabs = [
      { id: 'first', isDormant: false, title: 'First', type: 'route' as const, url: '/app/chat' },
      { id: 'second', isDormant: false, title: 'Second', type: 'route' as const, url: '/app/files' },
      { id: 'third', isDormant: false, title: 'Third', type: 'route' as const, url: '/app/notes' }
    ]
    const settingsTab = {
      id: 'settings',
      isDormant: false,
      title: 'Settings',
      type: 'route' as const,
      url: '/settings/provider'
    }
    mocks.tabs = workspaceTabs
    mocks.activeTabId = 'first'
    const view = render(<AppShell />)

    mocks.tabs = [...workspaceTabs, settingsTab]
    mocks.activeTabId = settingsTab.id
    view.rerender(<AppShell />)

    const closeFocusedTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeFocusedTab?.(settingsTab.id)

    expect(mocks.closeTabs).toHaveBeenCalledWith([settingsTab.id], 'first')
    expect(mocks.closeTab).not.toHaveBeenCalled()

    const detachFocusedTab = mocks.tabBarProps?.detachTab as ((id: string) => void) | undefined
    detachFocusedTab?.(settingsTab.id)

    expect(mocks.detachTab).toHaveBeenCalledWith(settingsTab.id)
    expect(mocks.setActiveTab).toHaveBeenCalledWith('first')
  })

  it('restores the most recently accessed workspace tab when Settings is restored active', () => {
    const settingsTab = {
      id: 'settings',
      isDormant: false,
      lastAccessTime: 400,
      title: 'Settings',
      type: 'route' as const,
      url: '/settings/provider'
    }
    mocks.tabs = [
      { id: 'home', isDormant: true, lastAccessTime: 300, title: 'Home', type: 'route', url: '/app/chat' },
      { id: 'files', isDormant: true, lastAccessTime: 100, title: 'Files', type: 'route', url: '/app/files' },
      settingsTab,
      {
        id: 'translate',
        isDormant: true,
        lastAccessTime: 200,
        title: 'Translate',
        type: 'route',
        url: '/app/translate'
      }
    ]
    mocks.activeTabId = settingsTab.id

    render(<AppShell />)

    const closeFocusedTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeFocusedTab?.(settingsTab.id)
    expect(mocks.closeTabs).toHaveBeenCalledWith([settingsTab.id], 'home')

    const detachFocusedTab = mocks.tabBarProps?.detachTab as ((id: string) => void) | undefined
    detachFocusedTab?.(settingsTab.id)
    expect(mocks.detachTab).toHaveBeenCalledWith(settingsTab.id)
    expect(mocks.setActiveTab).toHaveBeenCalledWith('home')
  })

  it('blocks and dismisses global search while the Settings tab is focused', () => {
    mocks.tabs = [
      ...mocks.tabs,
      {
        id: 'settings',
        isDormant: false,
        title: 'Settings',
        type: 'route',
        url: '/settings/provider'
      }
    ]
    mocks.activeTabId = 'settings'

    render(<AppShell />)
    mocks.commandHandlers.get('app.search')?.handler()

    expect(mocks.showSearchPopup).not.toHaveBeenCalled()
    expect(mocks.hideSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('keeps the Windows and Linux tab bar inside the content column beside the sidebar', () => {
    const { container } = render(<AppShell />)

    const root = container.firstElementChild
    const sidebar = screen.getByTestId('sidebar')
    const tabBar = screen.getByTestId('tab-bar')
    const tabRouter = screen.getByTestId('tab-router')
    const contentColumn = tabBar.parentElement

    if (!(root instanceof HTMLElement) || !(contentColumn instanceof HTMLElement)) {
      throw new Error('Expected AppShell to render a root and content column')
    }

    expect(sidebar.parentElement).toBe(root)
    expect(contentColumn.parentElement).toBe(root)
    expect(contentColumn).toContainElement(tabBar)
    expect(contentColumn).toContainElement(tabRouter)
    expect(contentColumn.querySelector('main')).toHaveAttribute('data-ui', 'app.content')
    expect(Array.from(root.children)).toEqual([sidebar, contentColumn])
    expect(mocks.tabBarProps).not.toHaveProperty('leftInset')
  })

  it('keeps the macOS traffic lights in the left column beside the tab/content column', () => {
    mocks.platformState.isMac = true

    const { container } = render(<AppShell />)

    const root = container.firstElementChild
    const sidebar = screen.getByTestId('sidebar')
    const tabBar = screen.getByTestId('tab-bar')
    const tabRouter = screen.getByTestId('tab-router')
    const trafficLightSpacer = screen.getByTestId('macos-traffic-light-spacer')
    const trafficLightDragRegion = screen.getByTestId('macos-traffic-light-drag-region')
    const leftColumn = sidebar.parentElement
    const contentColumn = tabBar.parentElement

    if (
      !(root instanceof HTMLElement) ||
      !(leftColumn instanceof HTMLElement) ||
      !(contentColumn instanceof HTMLElement)
    ) {
      throw new Error('Expected AppShell to render macOS left and content columns')
    }

    expect(trafficLightDragRegion.parentElement).toBe(root)
    expect(trafficLightDragRegion).toHaveClass('absolute', 'top-0', 'left-0')
    expect(trafficLightDragRegion).toHaveClass('w-[env(titlebar-area-x)]')
    expect(leftColumn.parentElement).toBe(root)
    expect(leftColumn).not.toHaveClass('min-w-[88px]')
    expect(contentColumn.parentElement).toBe(root)
    expect(Array.from(leftColumn.children)).toEqual([trafficLightSpacer, sidebar])
    expect(contentColumn).toContainElement(tabBar)
    expect(contentColumn).toContainElement(tabRouter)
    expect(Array.from(root.children)).toEqual([trafficLightDragRegion, leftColumn, contentColumn])
    expect(mocks.tabBarProps).not.toHaveProperty('leftInset')
    expect(mocks.tabBarProps).toHaveProperty('isFullscreen', false)
  })

  it('removes macOS traffic light placeholders when the window is fullscreen', async () => {
    mocks.platformState.isMac = true
    mocks.ipcRequest.mockResolvedValue(true)

    const { container } = render(<AppShell />)

    await waitFor(() => {
      expect(screen.queryByTestId('macos-traffic-light-spacer')).toBeNull()
    })

    const root = container.firstElementChild
    const sidebar = screen.getByTestId('sidebar')
    const tabBar = screen.getByTestId('tab-bar')
    const contentColumn = tabBar.parentElement

    if (!(root instanceof HTMLElement) || !(contentColumn instanceof HTMLElement)) {
      throw new Error('Expected AppShell to render a root and content column')
    }

    expect(mocks.ipcRequest).toHaveBeenCalledWith('window.is_full_screen')
    expect(screen.queryByTestId('macos-traffic-light-drag-region')).toBeNull()
    expect(sidebar.parentElement?.children).toHaveLength(1)
    expect(contentColumn.parentElement).toBe(root)
    expect(mocks.tabBarProps).toHaveProperty('isFullscreen', true)
  })

  it('updates macOS traffic light placeholders from fullscreen events', async () => {
    mocks.platformState.isMac = true

    render(<AppShell />)

    expect(await screen.findByTestId('macos-traffic-light-spacer')).toBeInTheDocument()

    act(() => {
      mocks.ipcHandlers.get('window.fullscreen_changed')?.(true)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('macos-traffic-light-spacer')).toBeNull()
    })

    expect(screen.queryByTestId('macos-traffic-light-drag-region')).toBeNull()
    expect(mocks.tabBarProps).toHaveProperty('isFullscreen', true)

    act(() => {
      mocks.ipcHandlers.get('window.fullscreen_changed')?.(false)
    })

    expect(await screen.findByTestId('macos-traffic-light-spacer')).toBeInTheDocument()
    expect(screen.getByTestId('macos-traffic-light-drag-region')).toBeInTheDocument()
    expect(mocks.tabBarProps).toHaveProperty('isFullscreen', false)
  })

  it('clears the split state when the last mini-app tab closes', () => {
    MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
    MockUseCacheUtils.setCacheValue('mini_app.split_id', 'right-app')
    mocks.tabs = [
      ...mocks.tabs,
      { id: 'mini-left', isDormant: false, title: 'Left', type: 'route', url: '/app/mini-app/left-app' }
    ]

    render(<AppShell />)
    const closeTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeTab?.('mini-left')

    // A surviving split would reopen the next mini app straight into the stale
    // pane and keep `right-app` pinned in the keep-alive pool.
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(false)
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('')
    expect(mocks.closeTab).toHaveBeenCalledWith('mini-left')
  })

  it('keeps the split state while another mini-app tab is still open', () => {
    MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
    MockUseCacheUtils.setCacheValue('mini_app.split_id', 'right-app')
    mocks.tabs = [
      ...mocks.tabs,
      { id: 'mini-left', isDormant: false, title: 'Left', type: 'route', url: '/app/mini-app/left-app' },
      { id: 'mini-other', isDormant: false, title: 'Other', type: 'route', url: '/app/mini-app/other-app' }
    ]

    render(<AppShell />)
    const closeTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeTab?.('mini-left')

    // The remaining mini-app tab still renders the split, so collapsing it here
    // would drop the pane out from under the user.
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(true)
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('right-app')
  })

  it('leaves non mini-app tab closes untouched', () => {
    MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
    MockUseCacheUtils.setCacheValue('mini_app.split_id', 'right-app')

    render(<AppShell />)
    const closeTab = mocks.tabBarProps?.closeTab as ((id: string) => void) | undefined
    closeTab?.('home')

    expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(true)
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('right-app')
  })

  it('clears the split state when the last mini-app tab detaches', () => {
    MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
    MockUseCacheUtils.setCacheValue('mini_app.split_id', 'right-app')
    mocks.tabs = [
      ...mocks.tabs,
      { id: 'mini-left', isDormant: false, title: 'Left', type: 'route', url: '/app/mini-app/left-app' }
    ]

    render(<AppShell />)
    const detachTab = mocks.tabBarProps?.detachTab as ((id: string) => void) | undefined
    detachTab?.('mini-left')

    // Split state does not follow the tab to the new window, so leaving it set
    // here reopens the next mini app straight into a split nobody asked for.
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(false)
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('')
    expect(mocks.detachTab).toHaveBeenCalledWith('mini-left')
  })

  it('keeps the split state when detaching leaves another mini-app tab behind', () => {
    MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
    MockUseCacheUtils.setCacheValue('mini_app.split_id', 'right-app')
    mocks.tabs = [
      ...mocks.tabs,
      { id: 'mini-left', isDormant: false, title: 'Left', type: 'route', url: '/app/mini-app/left-app' },
      { id: 'mini-other', isDormant: false, title: 'Other', type: 'route', url: '/app/mini-app/other-app' }
    ]

    render(<AppShell />)
    const detachTab = mocks.tabBarProps?.detachTab as ((id: string) => void) | undefined
    detachTab?.('mini-left')

    // The mini-app tab still in this window keeps rendering the split.
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(true)
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('right-app')
  })

  it('leaves non mini-app tab detaches untouched', () => {
    MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
    MockUseCacheUtils.setCacheValue('mini_app.split_id', 'right-app')

    render(<AppShell />)
    const detachTab = mocks.tabBarProps?.detachTab as ((id: string) => void) | undefined
    detachTab?.('home')

    expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(true)
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('right-app')
  })

  it('cycles tabs via command handlers', () => {
    mocks.tabs = [
      ...mocks.tabs,
      { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/app/files' },
      { id: 'tab3', isDormant: false, title: 'Tab 3', type: 'route', url: '/app/agents' }
    ]

    // home -> next -> tab2
    const { rerender } = render(<AppShell />)
    mocks.commandHandlers.get('tab.next')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab2')

    // tab3 -> next -> home
    mocks.activeTabId = 'tab3'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.next')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('home')

    // tab2 -> prev -> home
    mocks.activeTabId = 'tab2'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.prev')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('home')

    // home -> prev -> tab3
    mocks.activeTabId = 'home'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.prev')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab3')
  })

  it('disables tab cycling commands when there is no reachable next tab', () => {
    const { rerender } = render(<AppShell />)

    expect(mocks.commandHandlers.get('tab.next')?.options).toEqual({ enabled: false })
    expect(mocks.commandHandlers.get('tab.prev')?.options).toEqual({ enabled: false })

    mocks.tabs = [...mocks.tabs, { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/app/files' }]
    mocks.activeTabId = 'missing'
    rerender(<AppShell />)

    expect(mocks.commandHandlers.get('tab.next')?.options).toEqual({ enabled: false })
    expect(mocks.commandHandlers.get('tab.prev')?.options).toEqual({ enabled: false })

    mocks.activeTabId = 'home'
    rerender(<AppShell />)

    expect(mocks.commandHandlers.get('tab.next')?.options).toEqual({ enabled: true })
    expect(mocks.commandHandlers.get('tab.prev')?.options).toEqual({ enabled: true })
  })
})
