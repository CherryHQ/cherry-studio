// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mocks, platformState } = vi.hoisted(() => ({
  mocks: {
    commandHandlers: new Map<string, () => void>(),
    showSearchPopup: vi.fn()
  },
  platformState: { isMac: false }
}))

vi.mock('@renderer/databases/db', () => ({}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return platformState.isMac
  }
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void) => {
    mocks.commandHandlers.set(command, handler)
  }
}))

vi.mock('@renderer/ipc/useIpcOn', () => ({
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/components/Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('../../../hooks/tab', () => ({
  useMainSettingsTab: vi.fn(),
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
  default: () => null
}))

vi.mock('../AppShellTabBar', () => ({
  AppShellTabBar: () => <header data-testid="tab-bar" />
}))

vi.mock('../TabRouter', () => ({
  TabRouter: () => <section data-testid="tab-router" />
}))

import { AppShell } from '../AppShell'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.commandHandlers.clear()
  platformState.isMac = false
})

function expectSidebarAndContentColumnLayout(container: HTMLElement) {
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
  expect(Array.from(root.children)).toEqual([sidebar, contentColumn])
}

describe('AppShell', () => {
  it('opens global search from the shell-level shortcut', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.()

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('keeps the Windows and Linux tab bar inside the content column beside the sidebar', () => {
    const { container } = render(<AppShell />)

    expectSidebarAndContentColumnLayout(container)
  })

  it('uses the same sidebar and content column layout on macOS', () => {
    platformState.isMac = true

    const { container } = render(<AppShell />)

    expectSidebarAndContentColumnLayout(container)
  })
})
