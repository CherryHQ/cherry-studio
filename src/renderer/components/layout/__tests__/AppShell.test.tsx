// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commandHandlers: new Map<string, () => void>(),
  ipcHandlers: new Map<string, (value: unknown) => void>(),
  ipcRequest: vi.fn(() => Promise.resolve(false)),
  closeSettings: vi.fn(),
  openTab: vi.fn(),
  platformState: { isMac: false },
  settingsPath: null as string | null,
  settingsRouterProps: undefined as Record<string, unknown> | undefined,
  setSettingsPath: vi.fn(),
  tabBarProps: undefined as Record<string, unknown> | undefined,
  updateTab: vi.fn(),
  workspaceRouterProps: undefined as Record<string, unknown> | undefined,
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
  useCommandHandler: (command: string, handler: () => void) => {
    mocks.commandHandlers.set(command, handler)
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

vi.mock('../SettingsSurfaceProvider', () => ({
  useSettingsSurface: () => ({
    closeSettings: mocks.closeSettings,
    settingsPath: mocks.settingsPath,
    setSettingsPath: mocks.setSettingsPath
  })
}))

vi.mock('../../../hooks/tab', () => ({
  useTabs: () => ({
    activeTabId: 'home',
    closeTab: vi.fn(),
    openTab: mocks.openTab,
    pinTab: vi.fn(),
    reorderTabs: vi.fn(),
    setActiveTab: vi.fn(),
    tabs: [
      {
        id: 'home',
        isDormant: false,
        title: 'Chat',
        type: 'route',
        url: '/app/chat'
      }
    ],
    unpinTab: vi.fn(),
    updateTab: mocks.updateTab
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
  TabRouter: (props: Record<string, unknown>) => {
    const tab = props.tab as { id: string; url: string }
    if (tab.id === 'immersive-settings') {
      mocks.settingsRouterProps = props
      return <section data-testid="settings-router" data-url={tab.url} />
    }
    mocks.workspaceRouterProps = props
    return <section data-testid="tab-router" />
  }
}))

vi.mock('../../WindowControls', () => ({
  WindowControls: () => (mocks.platformState.isMac ? null : <div data-testid="window-controls" />)
}))

import { AppShell } from '../AppShell'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.commandHandlers.clear()
  mocks.ipcHandlers.clear()
  mocks.ipcRequest.mockResolvedValue(false)
  mocks.platformState.isMac = false
  mocks.settingsPath = null
  mocks.settingsRouterProps = undefined
  mocks.tabBarProps = undefined
  mocks.workspaceRouterProps = undefined
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

  it('opens global search from the shell-level shortcut', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.()

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('does not open global search while settings is immersive', () => {
    mocks.settingsPath = '/settings/provider'
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.()

    expect(mocks.showSearchPopup).not.toHaveBeenCalled()
  })

  it('dismisses an already-open global search when Settings takes over the window', () => {
    const { rerender } = render(<AppShell />)

    expect(mocks.hideSearchPopup).not.toHaveBeenCalled()

    mocks.settingsPath = '/settings/provider'
    rerender(<AppShell />)

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

  it('shows Settings as an immersive surface while preserving the hidden workspace shell', () => {
    mocks.settingsPath = '/settings/provider'

    render(<AppShell />)

    expect(screen.getByTestId('workspace-shell')).toHaveClass('hidden')
    expect(screen.getByTestId('settings-shell')).toBeVisible()
    expect(screen.getByTestId('settings-router')).toHaveAttribute('data-url', '/settings/provider')
    expect(screen.getByTestId('window-controls')).toBeInTheDocument()
    expect(mocks.workspaceRouterProps).toHaveProperty('isActive', false)
    expect(screen.getByRole('button', { name: /Back|返回/ })).toHaveFocus()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('closes immersive Settings from the title-bar Back action without changing tabs', () => {
    mocks.settingsPath = '/settings/provider'

    render(<AppShell />)

    fireEvent.click(screen.getByRole('button', { name: /Back|返回/ }))

    expect(mocks.closeSettings).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('syncs navigation inside the Settings router without opening a tab', () => {
    mocks.settingsPath = '/settings/provider'
    render(<AppShell />)

    act(() => {
      const onUrlChange = mocks.settingsRouterProps?.onUrlChange as ((url: string) => void) | undefined
      onUrlChange?.('/settings/about')
    })

    expect(mocks.setSettingsPath).toHaveBeenCalledWith('/settings/about')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('promotes Settings navigation from a workspace router into the immersive surface', () => {
    render(<AppShell />)

    act(() => {
      const onUrlChange = mocks.workspaceRouterProps?.onUrlChange as ((url: string) => void) | undefined
      onUrlChange?.('/settings/provider?id=openai')
    })

    expect(mocks.setSettingsPath).toHaveBeenCalledWith('/settings/provider?id=openai')
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('places the macOS Back action after the traffic-light area', () => {
    mocks.platformState.isMac = true
    mocks.settingsPath = '/settings/provider'

    render(<AppShell />)

    const titleBar = screen.getByTestId('settings-title-bar')
    expect(screen.getByTestId('settings-macos-traffic-light-spacer').parentElement).toBe(titleBar)
    expect(screen.queryByTestId('window-controls')).toBeNull()
    expect(screen.getByRole('button', { name: /Back|返回/ })).toBeInTheDocument()
  })

  it('removes the Settings traffic-light spacer in macOS fullscreen', async () => {
    mocks.platformState.isMac = true
    mocks.settingsPath = '/settings/provider'
    mocks.ipcRequest.mockResolvedValue(true)

    render(<AppShell />)

    await waitFor(() => {
      expect(screen.queryByTestId('settings-macos-traffic-light-spacer')).toBeNull()
    })
  })
})
