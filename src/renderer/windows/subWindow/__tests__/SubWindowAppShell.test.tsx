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
let windowFrameValue:
  | {
      mode: string
      translucent?: boolean
      chrome?: { titleLeading?: ReactNode; titleTrailing?: ReactNode }
    }
  | undefined

async function renderSubWindowAppShell({
  isPageTitledRoute = () => false,
  isMacTransparentWindow = false,
  isWindowFocused = true,
  tabs = defaultTabs
}: {
  isPageTitledRoute?: (url: string) => boolean
  isMacTransparentWindow?: boolean
  isWindowFocused?: boolean
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
    WindowFrameProvider: ({
      children,
      value
    }: {
      children: ReactNode
      value: {
        mode: string
        translucent?: boolean
        chrome?: { titleLeading?: ReactNode; titleTrailing?: ReactNode }
      }
    }) => {
      windowFrameValue = value
      return <>{children}</>
    }
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
  vi.doMock('@renderer/hooks/useWindowFocus', () => ({ default: () => isWindowFocused }))
  vi.doMock('@renderer/hooks/useMacTransparentWindow', () => ({ default: () => isMacTransparentWindow }))

  const { SubWindowAppShell } = await import('../SubWindowAppShell')
  return render(<SubWindowAppShell />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.resetModules()
  windowFrameValue = undefined
})

describe('SubWindowAppShell', () => {
  it('renders fallback chrome and a framed body for regular detached pages', async () => {
    const { container } = await renderSubWindowAppShell()

    expect(screen.getByTestId('sub-window-title-bar')).toBeInTheDocument()
    expect(screen.getByTestId('tab-router')).toBeInTheDocument()
    expect(container.querySelector('.border-frame-border')).toBeInTheDocument()
  })

  it('lets conversation pages own the title bar and injects the host chrome', async () => {
    await renderSubWindowAppShell({ isPageTitledRoute: () => true })

    expect(screen.queryByTestId('sub-window-title-bar')).not.toBeInTheDocument()
    expect(windowFrameValue?.mode).toBe('window')
    expect(windowFrameValue?.chrome?.titleLeading).toBeTruthy()
    expect(windowFrameValue?.chrome?.titleTrailing).toBeTruthy()
  })

  it('uses translucent sidebar styling only while a transparent macOS window is focused', async () => {
    const { container } = await renderSubWindowAppShell({ isMacTransparentWindow: true, isWindowFocused: true })

    expect(container.firstElementChild).toHaveClass('bg-sidebar/70')
    expect(container.querySelector('.border-frame-border')).toBeInTheDocument()
    expect(windowFrameValue?.translucent).toBe(true)
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
    expect(screen.queryByTestId('sub-window-title-bar')).not.toBeInTheDocument()
  })
})
