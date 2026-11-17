// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SubWindowInitData } from '@shared/types/subWindow'

type ShellTab = {
  id: string
  type: 'route'
  url: string
  title: string
}

const defaultTabs: ShellTab[] = [{ id: 'home', type: 'route', url: '/home', title: 'Home' }]
const openTab = vi.fn()
const closeTab = vi.fn()
const commandHandlers = new Map<string, () => void>()
const ipcListeners = new Map<string, (value: boolean) => void>()
let ipcRequest: ReturnType<typeof vi.fn> = vi.fn()

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
    ipcRequest = vi.fn(() => new Promise<boolean>(() => {}))
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
  vi.doMock('@renderer/hooks/command', () => ({
    useCommandHandler: (command: string, handler: () => void) => {
      commandHandlers.set(command, handler)
    }
  }))
  vi.doMock('@renderer/hooks/tab', async () => {
    const actual = (await vi.importActual('@renderer/hooks/tab')) as Record<string, unknown>
    return {
      ...(actual as object),
      useTabs: () => ({
        tabs: defaultTabs,
        activeTabId: 'home',
        setActiveTab: vi.fn(),
        closeTab,
        closeTabs: vi.fn(),
        updateTab: vi.fn(),
        addTab: vi.fn(),
        reorderTabs: vi.fn(),
        openTab,
        attachTab: openTab,
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
    WINDOW_CONTROLS_OVERLAY_WIDTH: '0px'
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
  commandHandlers.clear()
  ipcListeners.clear()
  ipcRequest = vi.fn()
})

describe('SubWindowAppShell', () => {
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
      expect(openTab).toHaveBeenCalledWith({
        url: '/app/chat?topicId=topic-1',
        id: 'detached-tab',
        title: 'Detached topic',
        icon: '🍒',
        type: 'route',
        isPinned: true,
        metadata: undefined
      })
    })
    expect(openTab).toHaveBeenCalledOnce()
  })

  it('closes the detached window from the tab-close shortcut', async () => {
    await renderSubWindowAppShell()

    commandHandlers.get('tab.close')?.()

    expect(ipcRequest).toHaveBeenCalledWith('window.close')
  })
})
