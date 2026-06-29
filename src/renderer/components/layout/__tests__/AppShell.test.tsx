// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isMac: false,
  commandHandlers: new Map<string, () => void>(),
  initData: null as { openSettingsTab: true } | null,
  ipcRequest: vi.fn(),
  openTab: vi.fn(),
  showSearchPopup: vi.fn()
}))

vi.mock('@renderer/databases', () => ({}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void) => {
    mocks.commandHandlers.set(command, handler)
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => mocks.initData
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.ipcRequest
  }
}))

vi.mock('@renderer/components/Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
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
  default: () => null
}))

vi.mock('../AppShellTabBar', () => ({
  AppShellTabBar: () => <header data-testid="tab-bar" />
}))

// Mirror TabRouter's real scoped-root marking so AppShell's chrome layout can be
// asserted without mounting the full router tree.
vi.mock('../TabRouter', () => ({
  TabRouter: ({ isActive }: { isActive: boolean }) => (
    <section data-testid="tab-router">
      {!mocks.isMac && isActive ? <div data-page-side-panel-root="true" data-testid="scoped-root" /> : null}
    </section>
  )
}))

import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'

import { AppShell } from '../AppShell'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.isMac = false
  mocks.commandHandlers.clear()
  mocks.initData = null
})

describe('AppShell page side panel root', () => {
  it('scopes the page side panel root to the tab content area, excluding app chrome, outside macOS', () => {
    mocks.isMac = false
    render(<AppShell />)

    const root = document.querySelector('[data-page-side-panel-root="true"]')
    expect(root).toBeInTheDocument()
    expect(root).not.toContainElement(screen.getByTestId('tab-bar'))
    expect(root).not.toContainElement(screen.getByTestId('sidebar'))
    expect(screen.getByTestId('tab-router')).toContainElement(root as HTMLElement)
  })

  it('does not mark a scoped page side panel root on macOS', () => {
    mocks.isMac = true
    render(<AppShell />)

    expect(document.querySelector('[data-page-side-panel-root="true"]')).not.toBeInTheDocument()
  })
})

describe('AppShell', () => {
  it('opens global search from the shell-level shortcut', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.()

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('opens settings in a tab from the shell-level settings command', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.settings.open')?.()

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', {
      title: getDefaultRouteTitle('/settings/provider')
    })
  })

  it('opens settings in a tab from main-window init data', () => {
    mocks.initData = { openSettingsTab: true }

    render(<AppShell />)

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', {
      title: getDefaultRouteTitle('/settings/provider')
    })
    expect(mocks.ipcRequest).toHaveBeenCalledWith('window.clear_init_data')
  })
})
