// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setRecentItems: vi.fn(),
  commandHandlers: new Map<string, () => void>(),
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

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: () => [[], mocks.setRecentItems]
}))

vi.mock('@renderer/components/Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('../../../hooks/useTabs', () => ({
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

vi.mock('../../MiniApp/MiniAppTabsPool', () => ({
  default: () => null
}))

vi.mock('../AppShellTabBar', () => ({
  AppShellTabBar: () => <header data-testid="tabbar" />
}))

vi.mock('../TabRouter', () => ({
  TabRouter: () => <section data-testid="tab-router" />
}))

import { AppShell } from '../AppShell'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.commandHandlers.clear()
})

describe('AppShell', () => {
  it('opens global search from the shell-level shortcut', () => {
    render(<AppShell />)

    mocks.commandHandlers.get('app.search')?.()

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })
})
