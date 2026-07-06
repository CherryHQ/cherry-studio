// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tabs = [{ id: 'home', type: 'route', url: '/home', title: 'Home' }]

async function renderSubWindowAppShell() {
  vi.resetModules()
  vi.doMock('@renderer/utils/platform', () => ({ isMac: false, isWin: false, isLinux: false }))
  vi.doMock('@renderer/databases', () => ({}))
  vi.doMock('@renderer/hooks/useWindowInitData', () => ({
    useWindowInitData: () => null
  }))
  vi.doMock('@renderer/hooks/tab', () => ({
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
  vi.doMock('@renderer/utils/routeTitle', () => ({
    getDefaultRouteTitle: (url: string) => url,
    isPageTitledRoute: () => false
  }))
  vi.doMock('@renderer/components/chat/shell/WindowFrameContext', () => ({
    WindowFrameProvider: ({ children }: { children: ReactNode }) => <>{children}</>
  }))
  vi.doMock('@renderer/components/layout/SubWindowControls', () => ({
    SubWindowControls: () => <div data-testid="sub-window-controls" />
  }))
  vi.doMock('@renderer/components/layout/SubWindowTitle', () => ({
    SubWindowTitle: () => <div data-testid="sub-window-title" />
  }))
  vi.doMock('@renderer/components/WindowControls', () => ({
    WindowControls: () => <div data-testid="window-controls" />,
    useHasWindowControls: () => false
  }))
  vi.doMock('../SubWindowTitleBar', () => ({
    SubWindowTitleBar: () => <header data-testid="sub-window-title-bar" />
  }))
  vi.doMock('@renderer/components/layout/TabRouter', () => ({
    TabRouter: () => <section data-testid="tab-router" />
  }))
  vi.doMock('@renderer/components/MiniApp/MiniAppTabsPool', () => ({
    default: () => <div data-testid="mini-app-pool" />
  }))

  const { SubWindowAppShell } = await import('../SubWindowAppShell')
  render(<SubWindowAppShell />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('SubWindowAppShell', () => {
  it('renders the title bar and tab router', async () => {
    await renderSubWindowAppShell()

    expect(screen.getByTestId('sub-window-title-bar')).toBeInTheDocument()
    expect(screen.getByTestId('tab-router')).toBeInTheDocument()
  })
})
