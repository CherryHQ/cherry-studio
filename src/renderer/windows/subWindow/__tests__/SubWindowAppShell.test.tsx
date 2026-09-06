// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { SubWindowInitData } from '@shared/types/subWindow'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
const ipcListeners = new Map<string, (value: boolean) => void>()
let ipcRequest: ReturnType<typeof vi.fn> = vi.fn()
let resolveInitialFullscreen: ((value: boolean) => void) | undefined

async function renderSubWindowAppShell({
  init = null,
  isMac = false
}: {
  init?: SubWindowInitData | null
  isMac?: boolean
} = {}) {
  vi.resetModules()
  vi.doMock('@renderer/utils/platform', () => ({ isMac, isWin: false, isLinux: false }))
  vi.doMock('@renderer/ipc', () => {
    ipcRequest = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveInitialFullscreen = resolve
        })
    )
    return {
      ipcApi: { request: ipcRequest },
      useIpcOn: (event: string, handler: (value: boolean) => void) => {
        ipcListeners.set(event, handler)
      }
    }
  })
  vi.doMock('@renderer/hooks/useWindowInitData', () => ({
    useWindowInitData: () => init
  }))
  vi.doMock('@renderer/hooks/tab', async () => {
    const actual = (await vi.importActual('@renderer/hooks/tab')) as Record<string, unknown>
    return {
      ...(actual as object),
      useTabs: () => ({
        tabs: defaultTabs,
        activeTabId: 'home',
        setActiveTab: vi.fn(),
        closeTab: vi.fn(),
        closeTabs: vi.fn(),
        updateTab: vi.fn(),
        addTab: vi.fn(),
        reorderTabs: vi.fn(),
        openTab,
        pinTab: vi.fn(),
        unpinTab: vi.fn()
      })
    }
  })
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
    SubWindowTitleBar: ({ isFullscreen }: { isFullscreen: boolean }) => (
      <header data-testid="sub-window-title-bar" data-fullscreen={String(isFullscreen)} />
    )
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
  ipcListeners.clear()
  ipcRequest = vi.fn()
  resolveInitialFullscreen = undefined
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

  it('reflects native fullscreen in the title bar on macOS', async () => {
    await renderSubWindowAppShell({ isMac: true })

    const titleBar = screen.getByTestId('sub-window-title-bar')
    expect(titleBar).toHaveAttribute('data-fullscreen', 'false')

    act(() => {
      ipcListeners.get('window.fullscreen_changed')?.(true)
    })

    expect(screen.getByTestId('sub-window-title-bar')).toHaveAttribute('data-fullscreen', 'true')
  })

  it('queries the initial fullscreen state on mount (macOS)', async () => {
    await renderSubWindowAppShell({ isMac: true })

    expect(ipcRequest).toHaveBeenCalledWith('window.is_full_screen')

    // Async act flushes the request's microtask so the mount-time update lands
    // inside the act scope.
    await act(async () => {
      resolveInitialFullscreen?.(true)
    })

    expect(screen.getByTestId('sub-window-title-bar')).toHaveAttribute('data-fullscreen', 'true')
  })
})
