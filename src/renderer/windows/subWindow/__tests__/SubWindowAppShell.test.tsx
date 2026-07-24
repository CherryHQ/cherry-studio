// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type ShellTab = {
  id: string
  type: 'route'
  url: string
  title: string
  metadata?: { instanceAppId: 'assistants' | 'agents'; instanceKey?: string }
}

const defaultTabs: ShellTab[] = [{ id: 'home', type: 'route', url: '/home', title: 'Home' }]
const updateTab = vi.fn()

async function renderSubWindowAppShell({
  isPageTitledRoute = () => false,
  tabs = defaultTabs
}: {
  isPageTitledRoute?: (url: string) => boolean
  tabs?: ShellTab[]
} = {}) {
  vi.resetModules()
  vi.doMock('@renderer/utils/platform', () => ({ isMac: false, isWin: false, isLinux: false }))
  vi.doMock('@renderer/hooks/useWindowInitData', () => ({
    useWindowInitData: () => null
  }))
  vi.doMock('@renderer/hooks/tab', () => ({
    useTabs: () => ({
      tabs,
      activeTabId: 'home',
      setActiveTab: vi.fn(),
      closeTab: vi.fn(),
      updateTab,
      addTab: vi.fn(),
      reorderTabs: vi.fn(),
      openTab: vi.fn(),
      pinTab: vi.fn(),
      unpinTab: vi.fn()
    })
  }))
  vi.doMock('@renderer/utils/routeTitle', () => ({
    getDefaultRouteTitle: (url: string) => url,
    isPageTitledRoute
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

    expect(screen.getByTestId('sub-window-title-bar')).toBeInTheDocument()
    expect(screen.getByTestId('tab-router')).toBeInTheDocument()
  })

  it('syncs a detached conversation URL from the active tab metadata', async () => {
    await renderSubWindowAppShell({
      isPageTitledRoute: (url) => url.startsWith('/app/chat'),
      tabs: [
        {
          id: 'home',
          type: 'route',
          url: '/app/chat?topicId=entry-topic',
          title: 'Current topic',
          metadata: { instanceAppId: 'assistants', instanceKey: 'current-topic' }
        }
      ]
    })

    await waitFor(() => {
      expect(updateTab).toHaveBeenCalledWith('home', { url: '/app/chat?topicId=current-topic' })
    })
    expect(screen.getByTestId('sub-window-title-bar')).toBeInTheDocument()
  })
})
