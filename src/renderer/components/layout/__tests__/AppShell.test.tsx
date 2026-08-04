// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commandHandlers: new Map<string, () => void>(),
  focusState: { value: true },
  ipcHandlers: new Map<string, (value: unknown) => void>(),
  ipcRequest: vi.fn(() => Promise.resolve(false)),
  platformState: { isMac: false },
  transparentState: { value: false },
  tabBarProps: undefined as Record<string, unknown> | undefined,
  showSearchPopup: vi.fn()
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => mocks.transparentState.value
}))

vi.mock('@renderer/hooks/useWindowFocus', () => ({
  default: () => mocks.focusState.value
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
    show: mocks.showSearchPopup
  }
}))

vi.mock('../../../hooks/tab', () => ({
  useMainWindowNavigation: vi.fn(),
  useTabs: () => ({
    activeTabId: 'home',
    closeTab: vi.fn(),
    openTab: vi.fn(),
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
  TabRouter: () => <section data-testid="tab-router" />
}))

import { AppShell } from '../AppShell'

const appShellCss = readFileSync(join(process.cwd(), 'src/renderer/components/layout/AppShell.css'), 'utf-8')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.commandHandlers.clear()
  mocks.ipcHandlers.clear()
  mocks.ipcRequest.mockResolvedValue(false)
  mocks.focusState.value = true
  mocks.platformState.isMac = false
  mocks.transparentState.value = false
  mocks.tabBarProps = undefined
})

describe('AppShell', () => {
  it('keeps the opaque and glass shell palette mode-aware', () => {
    expect(appShellCss).toContain('--app-shell-frame-border: #eaebe8')
    expect(appShellCss).toContain('--app-shell-frame-border-glass: #dadcd6')
    expect(appShellCss).toContain('--app-shell-selected-surface: #f0f0ef')
    expect(appShellCss).toContain('--app-shell-selected-border: #eaebe8')
    expect(appShellCss).toContain('--app-shell-frame-border: #32332c')
    expect(appShellCss).toContain('--app-shell-frame-border-glass: #3c3d35')
    expect(appShellCss).toContain('--app-shell-selected-surface: #1f201d')
    expect(appShellCss).toContain('--app-shell-selected-border: #343531')
  })

  it('activates glass only for a focused transparent window', () => {
    mocks.transparentState.value = true
    mocks.focusState.value = true

    const { container, rerender } = render(<AppShell />)
    expect(container.firstElementChild).toHaveAttribute('data-glass-active', 'true')

    mocks.focusState.value = false
    rerender(<AppShell />)
    expect(container.firstElementChild).toHaveAttribute('data-glass-active', 'false')
  })

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
})
