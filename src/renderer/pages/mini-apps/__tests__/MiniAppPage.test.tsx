// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp } from '@shared/data/types/miniApp'
import { cleanup, render, waitFor } from '@testing-library/react'
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
  allApps: [] as MiniApp[],
  openedKeepAliveMiniApps: [] as MiniApp[],
  openMiniAppKeepAlive: vi.fn(),
  updateTab: vi.fn(),
  currentTab: {
    id: 'launchpad-tab',
    type: 'route',
    url: '/app/mini-app/chatgpt',
    title: 'Launchpad',
    icon: undefined
  }
}))

vi.mock('@renderer/components/Icons', () => ({
  LogoAvatar: () => <div data-testid="logo-avatar" />
}))

vi.mock('@renderer/components/Icons/SvgIcon', () => ({
  OpenClawSidebarIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/pages/mini-apps/components/MinimalToolbar', () => ({
  default: () => <div data-testid="minimal-toolbar" />
}))

vi.mock('@renderer/pages/mini-apps/components/WebviewSearch', () => ({
  default: () => <div data-testid="webview-search" />
}))

vi.mock('@renderer/context/TabIdContext', () => ({
  useCurrentTab: () => mocks.currentTab,
  useCurrentTabId: () => mocks.currentTab.id
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: () => ({
    tabs: [mocks.currentTab],
    updateTab: mocks.updateTab
  })
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({
    openMiniAppKeepAlive: mocks.openMiniAppKeepAlive
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
  getWebviewLoaded: () => true,
  onWebviewStateChange: () => vi.fn(),
  setWebviewLoaded: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ appId: 'chatgpt' })
}))

vi.mock('react-i18next', () => ({
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
    mocks.allApps = [
      stubApp({
        appId: 'chatgpt',
        name: 'ChatGPT',
        url: 'https://chat.openai.com',
        logo: 'chat-logo'
      })
    ]
    mocks.openedKeepAliveMiniApps = []
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
})
