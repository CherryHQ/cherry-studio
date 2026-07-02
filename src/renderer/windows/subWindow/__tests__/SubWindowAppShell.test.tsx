// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tabs = [{ id: 'home', type: 'route', url: '/home', title: 'Home' }]

vi.mock('@renderer/utils/platform', () => ({ isMac: false, isWin: false, isLinux: false }))
vi.mock('@renderer/databases', () => ({}))
vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => null
}))
vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({
    tabs,
    activeTabId: 'home',
    setActiveTab: vi.fn(),
    closeTab: vi.fn(),
    updateTab: vi.fn(),
    addTab: vi.fn(),
    reorderTabs: vi.fn(),
    openTab: vi.fn(),
    pinTab: vi.fn(),
    unpinTab: vi.fn()
  })
}))
vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (url: string) => url,
  isPageTitledRoute: () => false
}))
vi.mock('../SubWindowTitleBar', () => ({
  SubWindowTitleBar: () => <header data-testid="sub-window-title-bar" />
}))
vi.mock('@renderer/components/layout/TabRouter', () => ({
  TabRouter: () => <section data-testid="tab-router" />
}))
vi.mock('@renderer/components/MiniApp/MiniAppTabsPool', () => ({
  default: () => <div data-testid="mini-app-pool" />
}))

import { SubWindowAppShell } from '../SubWindowAppShell'

function renderSubWindowAppShell() {
  render(<SubWindowAppShell />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SubWindowAppShell', () => {
  it('renders the title bar and tab router', () => {
    renderSubWindowAppShell()

    expect(screen.getByTestId('sub-window-title-bar')).toBeInTheDocument()
    expect(screen.getByTestId('tab-router')).toBeInTheDocument()
  })
})
