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
const openTab = vi.fn()
const openMiniAppKeepAlive = vi.fn()

async function renderSubWindowAppShell({
  isPageTitledRoute = () => false,
  tabs = defaultTabs,
  initData = null
}: {
  isPageTitledRoute?: (url: string) => boolean
  tabs?: ShellTab[]
  initData?: unknown
} = {}) {
  vi.resetModules()
  vi.doMock('@renderer/utils/platform', () => ({ isMac: false, isWin: false, isLinux: false }))
  vi.doMock('@renderer/hooks/useWindowInitData', () => ({
    useWindowInitData: () => initData
  }))
  vi.doMock('@renderer/hooks/useMiniAppPopup', () => ({
    useMiniAppPopup: () => ({ openMiniAppKeepAlive }),
    // Mirrors the real converter's transient-app convention.
    toTransientMiniApp: (input: Record<string, unknown>) => ({
      ...input,
      presetMiniAppId: null,
      status: 'enabled',
      orderKey: ''
    })
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
      openTab,
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
  vi.doMock('@renderer/components/ResourceViewSourceProvider', () => ({
    ResourceViewSourceProvider: ({ children }: { children: ReactNode }) => (
      <div data-testid="resource-view-source-provider">{children}</div>
    )
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

  // The keep-alive pool is per-window, so a transient mini app (OpenClaw's dashboard and
  // friends) is unknown here until the detach payload seeds it — otherwise the route
  // resolves to nothing and the window renders "app not found".
  it('seeds the keep-alive pool from a detached transient mini app', async () => {
    await renderSubWindowAppShell({
      initData: {
        tabId: 'tab-openclaw',
        url: '/app/mini-app/openclaw-dashboard',
        title: 'OpenClaw',
        type: 'route',
        miniApp: {
          appId: 'openclaw-dashboard',
          name: 'OpenClaw',
          url: 'http://127.0.0.1:18790#token=secret',
          logo: 'openclaw'
        }
      }
    })

    await waitFor(() => {
      expect(openMiniAppKeepAlive).toHaveBeenCalledWith(
        expect.objectContaining({ appId: 'openclaw-dashboard', url: 'http://127.0.0.1:18790#token=secret' })
      )
    })
    expect(openTab).toHaveBeenCalledWith(
      '/app/mini-app/openclaw-dashboard',
      expect.objectContaining({ forceNew: true })
    )
  })

  it('does not touch the keep-alive pool for an ordinary detached tab', async () => {
    await renderSubWindowAppShell({
      initData: { tabId: 'tab-chat', url: '/app/chat', title: 'Chat', type: 'route' }
    })

    await waitFor(() => expect(openTab).toHaveBeenCalled())
    expect(openMiniAppKeepAlive).not.toHaveBeenCalled()
  })
})
