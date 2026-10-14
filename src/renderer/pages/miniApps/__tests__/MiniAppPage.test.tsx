// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MiniApp, SiteMiniApp } from '@shared/data/types/miniApp'

import MiniAppPage from '../MiniAppPage'

const stubApp = (overrides: Partial<SiteMiniApp> & Pick<SiteMiniApp, 'appId' | 'name' | 'url'>): MiniApp => ({
  kind: 'site',
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
  openSplit: vi.fn(),
  closeSplit: vi.fn(),
  splitOpen: false,
  splitMiniAppId: '',
  updateTab: vi.fn(),
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
  default: ({
    onReload,
    onSplit,
    splitMode,
    splitActive
  }: {
    onReload: () => void
    onSplit: () => void
    splitMode: string
    splitActive?: boolean
  }) => (
    <>
      <button data-testid="minimal-toolbar" onClick={onReload} type="button">
        Reload
      </button>
      <button
        data-testid={`split-control-${splitMode}`}
        data-split-active={String(Boolean(splitActive))}
        onClick={onSplit}
        type="button">
        split
      </button>
    </>
  )
}))

// Stubbed out: this suite covers the page's own split wiring, not the picker's
// contents, which have their own tests.
vi.mock('@renderer/pages/miniApps/components/SplitPanePicker', () => ({
  default: () => <div data-testid="split-picker" />
}))

vi.mock('@renderer/components/WebviewSearch', () => ({
  // Surfaces which pane owns the host Find shortcut: the listener behind this
  // is a global window handler, so only one mounted instance may answer it.
  default: ({ targetId, hostShortcutEnabled }: { targetId: string; hostShortcutEnabled?: boolean }) => (
    <div data-testid="webview-search" data-app-id={targetId} data-host-shortcut={String(hostShortcutEnabled ?? true)} />
  )
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
    openSplit: mocks.openSplit,
    closeSplit: mocks.closeSplit
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
    splitOpen: mocks.splitOpen,
    splitMiniAppId: mocks.splitMiniAppId,
    isLoading: false,
    error: null
  })
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
    mocks.splitOpen = false
    mocks.splitMiniAppId = ''
    mocks.isActiveTab = true
    mocks.currentTab = {
      id: 'launchpad-tab',
      type: 'route',
      url: '/app/mini-app/chatgpt',
      title: 'Launchpad',
      icon: undefined
    }
    mocks.updateTab.mockClear()
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
  })

  it('renders not-found when neither the database nor the registry knows the app', async () => {
    mocks.appId = 'ghost-app'

    render(<MiniAppPage />)

    await waitFor(() => expect(screen.getByText('miniApp.error.not_found')).toBeInTheDocument())
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

  it('gives the host Find shortcut to exactly one pane while split', async () => {
    mocks.appId = 'deepseek'
    mocks.currentTab = { ...mocks.currentTab, url: '/app/mini-app/deepseek' }
    mocks.allApps = [
      stubApp({ appId: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com' }),
      stubApp({ appId: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn' })
    ]
    mocks.splitOpen = true
    mocks.splitMiniAppId = 'kimi'

    render(<MiniAppPage />)

    const searches = await screen.findAllByTestId('webview-search')
    expect(searches).toHaveLength(2)

    // Both panes mount a search overlay behind a *global* window keydown
    // listener, so leaving both enabled makes one Ctrl/Cmd+F open both.
    const owners = searches.filter((el) => el.dataset.hostShortcut === 'true')
    expect(owners).toHaveLength(1)
    expect(owners[0].dataset.appId).toBe('deepseek')
  })

  it('turns the primary split control into a way back out once split', async () => {
    mocks.splitOpen = true
    mocks.splitMiniAppId = ''

    render(<MiniAppPage />)

    // Left as a plain "open the split" action it does nothing on a second
    // press — the split is already open — so the button looks broken.
    const control = (await screen.findAllByTestId('split-control-open'))[0]
    expect(control.dataset.splitActive).toBe('true')

    fireEvent.click(control)
    expect(mocks.closeSplit).toHaveBeenCalled()
    expect(mocks.openSplit).not.toHaveBeenCalled()
  })

  it('keeps the single pane owning the host Find shortcut when not split', async () => {
    render(<MiniAppPage />)

    const searches = await screen.findAllByTestId('webview-search')
    expect(searches).toHaveLength(1)
    expect(searches[0].dataset.hostShortcut).toBe('true')
  })
})
