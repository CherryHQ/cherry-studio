// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { SubWindowInitData } from '@shared/types/subWindow'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type ShellTab = {
  id: string
  type: 'route'
  url: string
  title: string
}

const defaultTabs: ShellTab[] = [{ id: 'home', type: 'route', url: '/home', title: 'Home' }]
const openTab = vi.fn()

async function renderSubWindowAppShell({ init = null }: { init?: SubWindowInitData | null } = {}) {
  vi.resetModules()
  vi.doMock('@renderer/utils/platform', () => ({ isMac: false, isWin: false, isLinux: false }))
  vi.doMock('@renderer/hooks/useWindowInitData', () => ({
    useWindowInitData: () => init
  }))
  vi.doMock('@renderer/hooks/tab', () => ({
    useTabs: () => ({
      tabs: defaultTabs,
      activeTabId: 'home',
      setActiveTab: vi.fn(),
      closeTab: vi.fn(),
      updateTab: vi.fn(),
      addTab: vi.fn(),
      reorderTabs: vi.fn(),
      openTab,
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
  vi.doMock('@renderer/components/ResourceViewSourceProvider', () => ({
    ResourceViewSourceProvider: ({ children }: { children: ReactNode }) => (
      <div data-testid="resource-view-source-provider">{children}</div>
    )
  }))
  vi.doMock('@renderer/components/MiniApp/MiniAppTabsCleanup', () => ({
    default: () => null
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

    const provider = screen.getByTestId('resource-view-source-provider')

    expect(screen.getByTestId('sub-window-title-bar')).toBeInTheDocument()
    expect(provider).toContainElement(screen.getByTestId('tab-router'))
    expect(provider).not.toContainElement(screen.getByTestId('sub-window-title-bar'))
    expect(provider).not.toContainElement(screen.getByTestId('mini-app-pool'))
  })

  it('opens the detached tab from WindowManager init data', async () => {
    await renderSubWindowAppShell({
      init: {
        tabId: 'detached-tab',
        url: '/app/chat?topicId=topic-1',
        title: 'Detached topic',
        icon: '🍒',
        isPinned: true
      }
    })

    await waitFor(() => {
      expect(openTab).toHaveBeenCalledWith('/app/chat?topicId=topic-1', {
        id: 'detached-tab',
        title: 'Detached topic',
        icon: '🍒',
        type: 'route',
        isPinned: true,
        forceNew: true
      })
    })
    expect(openTab).toHaveBeenCalledOnce()
  })
})
