// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp } from '@shared/data/types/miniApp'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppPage from '../MiniAppPage'

const stubApp = (overrides: Partial<MiniApp> & Pick<MiniApp, 'appId' | 'name' | 'url'>): MiniApp => ({
  appId: overrides.appId,
  presetMiniAppId: overrides.presetMiniAppId ?? overrides.appId,
  status: overrides.status ?? 'enabled',
  orderKey: overrides.orderKey ?? 'a0',
  name: overrides.name,
  nameKey: overrides.nameKey,
  url: overrides.url,
  logo: overrides.logo ?? `${overrides.appId}-logo`,
  bordered: overrides.bordered,
  background: overrides.background,
  supportedRegions: overrides.supportedRegions
})

const mocks = vi.hoisted(() => ({
  appId: 'chatgpt',
  allApps: [] as MiniApp[],
  openedKeepAliveMiniApps: [] as MiniApp[],
  openMiniAppKeepAlive: vi.fn(),
  updateTab: vi.fn(),
  setWebviewLoaded: vi.fn(),
  webviewLoaded: true,
  webviewStateListeners: new Set<(loaded: boolean) => void>(),
  isActiveTab: true,
  currentTab: {
    id: 'launchpad-tab',
    type: 'route',
    url: '/app/mini-app/chatgpt',
    title: 'Launchpad',
    icon: undefined
  }
}))

vi.mock('@renderer/components/icons/LogoAvatar', () => ({
  default: () => <div data-testid="logo-avatar" />
}))

vi.mock('@renderer/components/icons/SvgIcon', () => ({
  OpenClawSidebarIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/pages/miniApps/components/MinimalToolbar', () => ({
  default: ({ onReload }: { onReload: () => void }) => (
    <button data-testid="minimal-toolbar" onClick={onReload} type="button">
      Reload
    </button>
  )
}))

vi.mock('@renderer/pages/miniApps/components/WebviewSearch', () => ({
  default: () => <div data-testid="webview-search" />
}))

vi.mock('@renderer/hooks/tab', () => ({
  useCurrentTab: () => mocks.currentTab,
  useCurrentTabId: () => mocks.currentTab.id,
  useIsActiveTab: () => mocks.isActiveTab,
  useOptionalTabsContext: () => ({
    tabs: [mocks.currentTab],
    updateTab: mocks.updateTab
  })
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({
    openMiniAppKeepAlive: mocks.openMiniAppKeepAlive
  }),
  // Mirrors the real converter's transient-app convention.
  toTransientMiniApp: (input: Record<string, unknown>) => ({
    ...input,
    presetMiniAppId: null,
    status: 'enabled',
    orderKey: ''
  })
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    allApps: mocks.allApps,
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    isLoading: false,
    error: null
  })
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  getWebviewLoaded: () => mocks.webviewLoaded,
  onWebviewStateChange: (_appId: string, listener: (loaded: boolean) => void) => {
    mocks.webviewStateListeners.add(listener)
    return () => mocks.webviewStateListeners.delete(listener)
  },
  setWebviewLoaded: mocks.setWebviewLoaded
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ appId: mocks.appId })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('react-spinners/BeatLoader', () => ({
  default: () => <div data-testid="beat-loader" />
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

describe('MiniAppPage', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    MockUseCacheUtils.resetMocks()
    mocks.appId = 'chatgpt'
    mocks.allApps = [
      stubApp({
        appId: 'chatgpt',
        name: 'ChatGPT',
        url: 'https://chat.openai.com',
        logo: 'chat-logo'
      })
    ]
    mocks.openedKeepAliveMiniApps = []
    mocks.webviewLoaded = true
    mocks.webviewStateListeners.clear()
    mocks.isActiveTab = true
    mocks.currentTab = {
      id: 'launchpad-tab',
      type: 'route',
      url: '/app/mini-app/chatgpt',
      title: 'Launchpad',
      icon: undefined
    }
    mocks.updateTab.mockClear()
    mocks.openMiniAppKeepAlive.mockClear()
    globalThis.CSS = { escape: (value: string) => value } as typeof CSS
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('syncs the owning tab title and icon to the concrete mini app', async () => {
    render(<MiniAppPage />)

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('launchpad-tab', {
        title: 'ChatGPT',
        icon: 'chat-logo'
      })
    )
    expect(mocks.openMiniAppKeepAlive).toHaveBeenCalledWith(mocks.allApps[0])
  })

  it('does not drive the keep-alive pool from a background (non-active) tab', async () => {
    // A backgrounded mini-app page (e.g. a pinned mini-app tab still mounted via
    // keep-alive) must not touch the global currentMiniAppId / LRU order — that
    // is what ping-pongs two mounted pages into an infinite render loop.
    mocks.isActiveTab = false

    render(<MiniAppPage />)

    await waitFor(() =>
      expect(mocks.updateTab).toHaveBeenCalledWith('launchpad-tab', {
        title: 'ChatGPT',
        icon: 'chat-logo'
      })
    )
    expect(mocks.openMiniAppKeepAlive).not.toHaveBeenCalled()
  })

  // A transient mini app (OpenClaw's dashboard and friends) has no database row and its
  // keep-alive entry is per-window and LRU-evictable. This is the state a window is in
  // after a tab is detached into it — and the state the main window is in when that tab
  // is attached back after eviction. The shared registry is what resolves it in both.
  it('resolves a transient mini app from the cross-window registry', async () => {
    mocks.appId = 'openclaw-dashboard'
    mocks.currentTab = {
      id: 'detached-tab',
      type: 'route',
      url: '/app/mini-app/openclaw-dashboard',
      title: 'OpenClaw',
      icon: undefined
    }
    MockUseCacheUtils.setSharedCacheValue('mini_app.transient_descriptor.openclaw-dashboard', {
      appId: 'openclaw-dashboard',
      name: 'OpenClaw',
      url: 'http://127.0.0.1:18790#token=secret',
      logo: 'openclaw'
    })

    render(<MiniAppPage />)

    await waitFor(() =>
      expect(mocks.openMiniAppKeepAlive).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'openclaw-dashboard',
          url: 'http://127.0.0.1:18790#token=secret',
          // Pool bookkeeping is this window's own — reconstructed, never carried.
          presetMiniAppId: null,
          status: 'enabled',
          orderKey: ''
        })
      )
    )
    expect(screen.queryByText('miniApp.error.not_found')).not.toBeInTheDocument()
  })

  it('prefers a republished transient descriptor over a stale local keep-alive snapshot', async () => {
    mocks.appId = 'openclaw-dashboard'
    mocks.currentTab = {
      id: 'detached-tab',
      type: 'route',
      url: '/app/mini-app/openclaw-dashboard',
      title: 'OpenClaw',
      icon: undefined
    }
    mocks.openedKeepAliveMiniApps = [
      stubApp({
        appId: 'openclaw-dashboard',
        name: 'OpenClaw',
        url: 'http://127.0.0.1:18790#token=stale'
      })
    ]
    MockUseCacheUtils.setSharedCacheValue('mini_app.transient_descriptor.openclaw-dashboard', {
      appId: 'openclaw-dashboard',
      name: 'OpenClaw',
      url: 'http://127.0.0.1:18790#token=fresh',
      logo: 'openclaw'
    })

    render(<MiniAppPage />)

    await waitFor(() =>
      expect(mocks.openMiniAppKeepAlive).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'openclaw-dashboard',
          url: 'http://127.0.0.1:18790#token=fresh'
        })
      )
    )
  })

  it('falls back to a local keep-alive snapshot when no transient descriptor exists', async () => {
    const cached = stubApp({
      appId: 'openclaw-dashboard',
      name: 'OpenClaw',
      url: 'http://127.0.0.1:18790#token=cached'
    })
    mocks.appId = 'openclaw-dashboard'
    mocks.openedKeepAliveMiniApps = [cached]

    render(<MiniAppPage />)

    await waitFor(() => expect(mocks.openMiniAppKeepAlive).toHaveBeenCalledWith(cached))
  })

  it('renders not-found when neither the database nor the registry knows the app', async () => {
    mocks.appId = 'ghost-app'

    render(<MiniAppPage />)

    await waitFor(() => expect(screen.getByText('miniApp.error.not_found')).toBeInTheDocument())
    expect(mocks.openMiniAppKeepAlive).not.toHaveBeenCalled()
  })

  it('keeps loading instead of flashing not-found until the shared cache has hydrated', async () => {
    // The shared cache syncs from Main asynchronously and does not block renderer
    // startup, so a freshly detached window renders before the descriptor is readable.
    mocks.appId = 'openclaw-dashboard'
    MockCacheUtils.setSharedCacheReady(false)

    render(<MiniAppPage />)

    await waitFor(() => expect(screen.getByTestId('beat-loader')).toBeInTheDocument())
    expect(screen.queryByText('miniApp.error.not_found')).not.toBeInTheDocument()
  })

  it('reloads the current mini app page without resetting it to the configured home URL', async () => {
    const reload = vi.fn()
    const webview = {
      src: 'https://chat.openai.com/c/123',
      reload,
      isConnected: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    vi.spyOn(document, 'querySelector').mockReturnValue(webview as unknown as Element)

    const { getByTestId } = render(<MiniAppPage />)
    fireEvent.click(getByTestId('minimal-toolbar'))

    expect(reload).toHaveBeenCalledOnce()
    expect(webview.src).toBe('https://chat.openai.com/c/123')
  })
  it('does not call WebView methods before the mini app has finished loading', () => {
    mocks.webviewLoaded = false
    const reload = vi.fn()
    const webview = {
      src: 'https://chat.openai.com',
      reload,
      isConnected: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    vi.spyOn(document, 'querySelector').mockReturnValue(webview as unknown as Element)

    const { getByTestId } = render(<MiniAppPage />)
    fireEvent.click(getByTestId('minimal-toolbar'))

    expect(reload).not.toHaveBeenCalled()
    expect(mocks.setWebviewLoaded).not.toHaveBeenCalled()
  })

  it('drops a stale WebView after LRU eviction and waits for its replacement to load', async () => {
    const staleReload = vi.fn()
    const staleWebview = {
      src: 'https://chat.openai.com/c/123',
      reload: staleReload,
      isConnected: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    const replacementReload = vi.fn()
    const replacementWebview = {
      src: 'https://chat.openai.com/c/123',
      reload: replacementReload,
      isConnected: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    let currentWebview: typeof staleWebview | typeof replacementWebview | null = staleWebview
    vi.spyOn(document, 'querySelector').mockImplementation(() => currentWebview as unknown as Element)

    const { getByTestId } = render(<MiniAppPage />)

    act(() => {
      mocks.webviewLoaded = false
      staleWebview.isConnected = false
      currentWebview = null
      mocks.webviewStateListeners.forEach((listener) => listener(false))
    })
    fireEvent.click(getByTestId('minimal-toolbar'))

    expect(staleReload).not.toHaveBeenCalled()
    expect(replacementReload).not.toHaveBeenCalled()

    currentWebview = replacementWebview
    act(() => {
      mocks.webviewLoaded = true
      mocks.webviewStateListeners.forEach((listener) => listener(true))
    })
    await waitFor(() => expect(replacementWebview.addEventListener).toHaveBeenCalled())
    fireEvent.click(getByTestId('minimal-toolbar'))

    expect(staleReload).not.toHaveBeenCalled()
    expect(replacementReload).toHaveBeenCalledOnce()
  })
})
