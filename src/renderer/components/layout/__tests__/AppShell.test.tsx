// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commandHandlers: new Map<string, { handler: () => void; options?: { enabled?: boolean } }>(),
  showSearchPopup: vi.fn(),
  setActiveTab: vi.fn(),
  tabs: [
    { id: 'tab1', isDormant: false, title: 'Tab 1', type: 'route', url: '/tab1' },
    { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/tab2' },
    { id: 'tab3', isDormant: false, title: 'Tab 3', type: 'route', url: '/tab3' }
  ],
  activeTabId: 'tab1'
}))

vi.mock('@renderer/databases/db', () => ({}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void, options?: { enabled?: boolean }) => {
    mocks.commandHandlers.set(command, { handler, options })
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
    activeTabId: mocks.activeTabId,
    closeTab: vi.fn(),
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
  mocks.tabs = [
    { id: 'tab1', isDormant: false, title: 'Tab 1', type: 'route', url: '/tab1' },
    { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/tab2' },
    { id: 'tab3', isDormant: false, title: 'Tab 3', type: 'route', url: '/tab3' }
  ]
  mocks.activeTabId = 'tab1'
})

describe('AppShell', () => {
  it('opens global search from the shell-level shortcut', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.handler()

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })

  it('cycles tabs via command handlers', () => {
    // tab1 -> next -> tab2
    mocks.activeTabId = 'tab1'
    const { rerender } = render(<AppShell />)

    mocks.commandHandlers.get('tab.next')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab2')

    // tab3 -> next -> tab1
    mocks.activeTabId = 'tab3'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.next')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab1')

    // tab2 -> prev -> tab1
    mocks.activeTabId = 'tab2'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.prev')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab1')

    // tab1 -> prev -> tab3
    mocks.activeTabId = 'tab1'
    rerender(<AppShell />)
    mocks.setActiveTab.mockClear()
    mocks.commandHandlers.get('tab.prev')?.handler()
    expect(mocks.setActiveTab).toHaveBeenCalledWith('tab3')
  })
  it('disables tab cycling commands when there is no reachable next tab', () => {
    mocks.tabs = [{ id: 'tab1', isDormant: false, title: 'Tab 1', type: 'route', url: '/tab1' }]
    mocks.activeTabId = 'tab1'

    const { rerender } = render(<AppShell />)

    expect(mocks.commandHandlers.get('tab.next')?.options).toEqual({ enabled: false })
    expect(mocks.commandHandlers.get('tab.prev')?.options).toEqual({ enabled: false })

    mocks.tabs = [
      { id: 'tab1', isDormant: false, title: 'Tab 1', type: 'route', url: '/tab1' },
      { id: 'tab2', isDormant: false, title: 'Tab 2', type: 'route', url: '/tab2' }
    ]
    mocks.activeTabId = 'missing'
    rerender(<AppShell />)

    expect(mocks.commandHandlers.get('tab.next')?.options).toEqual({ enabled: false })
    expect(mocks.commandHandlers.get('tab.prev')?.options).toEqual({ enabled: false })

    mocks.activeTabId = 'tab1'
    rerender(<AppShell />)

    expect(mocks.commandHandlers.get('tab.next')?.options).toEqual({ enabled: true })
    expect(mocks.commandHandlers.get('tab.prev')?.options).toEqual({ enabled: true })
  })
})
