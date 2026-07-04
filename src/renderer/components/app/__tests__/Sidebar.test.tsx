// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { SidebarAppId } from '@renderer/utils/sidebar'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeTab = {
  id: string
  type: 'route' | 'miniapp'
  url: string
  title: string
  icon?: string
  isPinned?: boolean
  metadata?: Record<string, unknown>
}

type FakeMiniApp = {
  appId: string
  name: string
  logo?: string
  url: string
}

const mocks = vi.hoisted(() => ({
  emitResourceListReveal: vi.fn(),
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  updateTab: vi.fn(),
  activeTab: {
    id: 'chat',
    type: 'route',
    url: '/app/chat',
    title: 'Chat'
  } as FakeTab | null,
  setSidebarWidth: vi.fn(),
  setSidebarFavorites: vi.fn(() => Promise.resolve()),
  reorderMiniAppsByStatus: vi.fn(() => Promise.resolve()),
  showUserPopup: vi.fn(),
  sidebarWidth: 50,
  tabs: [] as FakeTab[],
  sidebarFavorites: [{ type: 'app', id: 'assistants' }] as SidebarFavoriteItem[],
  sidebarMiniAppFavorites: [] as SidebarFavoriteItem[],
  allApps: [] as FakeMiniApp[],
  visibleMiniApps: null as FakeMiniApp[] | null,
  pinnedMiniApps: [] as FakeMiniApp[],
  onEntriesReorder: undefined as ((event: { oldIndex: number; newIndex: number }) => void) | undefined
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [
    mocks.sidebarWidth,
    (width: number) => {
      mocks.sidebarWidth = width
      mocks.setSidebarWidth(width)
    }
  ]
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.user.name') return ['JD']
    if (key === 'ui.sidebar.favorites')
      return [[...mocks.sidebarFavorites, ...mocks.sidebarMiniAppFavorites], mocks.setSidebarFavorites]
    return [undefined]
  }
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => undefined
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    allApps: mocks.allApps,
    miniApps: mocks.visibleMiniApps ?? mocks.allApps,
    pinned: mocks.pinnedMiniApps,
    reorderMiniAppsByStatus: mocks.reorderMiniAppsByStatus
  })
}))
vi.mock('@renderer/i18n/label', () => ({
  getSidebarIconLabelKey: (icon: string) =>
    ({
      agents: 'Work',
      assistants: 'Chat',
      translate: 'Translate'
    })[icon] ?? icon
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (url: string) =>
    ({
      '/app/agents': 'Work',
      '/app/chat': 'Chat',
      '/app/files': 'Files',
      '/app/translate': 'Translate'
    })[url] ?? 'Chat'
}))

vi.mock('@renderer/services/resourceListRevealEvents', () => ({
  emitResourceListReveal: mocks.emitResourceListReveal
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({
    activeTab: mocks.activeTab,
    tabs: mocks.tabs,
    openTab: mocks.openTab,
    updateTab: mocks.updateTab,
    setActiveTab: mocks.setActiveTab
  }),
  useOptionalTabsContext: () => ({
    tabs: mocks.tabs,
    openTab: mocks.openTab,
    setActiveTab: mocks.setActiveTab
  })
}))

vi.mock('../../Popups/UserPopup', () => ({
  default: {
    show: mocks.showUserPopup
  }
}))

vi.mock('../../icons/SvgIcon', () => ({
  OpenClawSidebarIcon: () => null
}))

vi.mock('../../Sidebar/primitives', () => ({
  UserAvatar: ({ user, className }: { user: { name: string }; className?: string }) => (
    <div className={className} data-testid="sidebar-user-avatar">
      {user.name}
    </div>
  )
}))

vi.mock('../../layout/ShellTabBarActions', () => ({
  SidebarShellActions: ({ layout, onSettingsClick }: { layout: string; onSettingsClick: () => void }) => (
    <button type="button" data-testid={`sidebar-shell-actions-${layout}`} onClick={onSettingsClick} />
  )
}))

type MockSidebarEntry = {
  key: string
  label: string
  isActive: (active: { activeItem: string; activeTabId?: string }) => boolean
  onOpen: () => void
  contextMenuItems?: Array<{ id: string; label: string; enabled?: boolean; onSelect?: () => void }>
}

const parseEntryKey = (key: string) => {
  const idx = key.indexOf(':')
  return { type: key.slice(0, idx), id: key.slice(idx + 1) }
}

vi.mock('../../Sidebar', () => ({
  Sidebar: ({
    isFloating,
    isFloatingClosing,
    onDismiss,
    onHoverChange,
    onEntriesReorder,
    active,
    entries,
    title,
    logo,
    user,
    actions,
    width,
    onResizePreview
  }: {
    isFloating?: boolean
    isFloatingClosing?: boolean
    active?: { activeItem: string; activeTabId?: string }
    entries?: MockSidebarEntry[]
    title?: string
    logo?: ReactNode
    user?: unknown
    actions?: ReactNode | ((layout: 'icon' | 'full') => ReactNode)
    width?: number
    onResizePreview?: (width: number | null) => void
    onDismiss?: () => void
    onHoverChange?: (hovering: boolean) => void
    onEntriesReorder?: (event: { oldIndex: number; newIndex: number }) => void
  }) => {
    mocks.onEntriesReorder = onEntriesReorder
    // Entries are type-agnostic resolved rows; the tests still assert per-type
    // testids, so recover the type/id from the stable `entry.key` (`${type}:${id}`).
    const activeState = active ?? { activeItem: '' }
    const items = entries?.filter((entry) => parseEntryKey(entry.key).type === 'app')
    const dockedTabs = entries?.filter((entry) => parseEntryKey(entry.key).type === 'mini_app')
    return isFloating ? (
      <div
        className={isFloatingClosing ? 'slide-out-to-left-2 animate-out' : 'slide-in-from-left-2 animate-in'}
        data-testid="floating-sidebar">
        <button type="button" onClick={onDismiss}>
          dismiss
        </button>
      </div>
    ) : (
      <>
        <div data-testid="sidebar-title">{title}</div>
        <div data-testid="sidebar-logo">{logo}</div>
        <div data-testid="sidebar-footer-user">{user ? 'user' : 'none'}</div>
        <div data-testid="sidebar-footer-actions">{typeof actions === 'function' ? actions('icon') : actions}</div>
        <button type="button" data-testid="preview-80" onClick={() => onResizePreview?.(80)} />
        <button type="button" data-testid="preview-null" onClick={() => onResizePreview?.(null)} />
        <button type="button" onClick={() => onHoverChange?.(true)}>
          reveal
        </button>
        <div data-testid="ui-sidebar" data-width={width} />
        <div data-testid="sidebar-items">
          {items?.map((item) => (
            <div key={item.key}>
              <button
                type="button"
                data-testid={`sidebar-item-${parseEntryKey(item.key).id}`}
                onClick={() => item.onOpen()}>
                <span>{item.label}</span>
              </button>
              {item.contextMenuItems?.map((menuItem) => (
                <button
                  key={menuItem.id}
                  type="button"
                  data-testid={`sidebar-menu-${menuItem.id}`}
                  disabled={menuItem.enabled === false}
                  onClick={menuItem.onSelect}>
                  {menuItem.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div data-testid="sidebar-mini-app-section">
          {dockedTabs?.map((miniTab) => (
            <div key={miniTab.key}>
              <button
                type="button"
                data-active={miniTab.isActive(activeState) ? 'true' : 'false'}
                data-testid={`sidebar-mini-app-${parseEntryKey(miniTab.key).id}`}
                onClick={() => miniTab.onOpen()}>
                {miniTab.label}
              </button>
              {miniTab.contextMenuItems?.map((menuItem) => (
                <button
                  key={menuItem.id}
                  type="button"
                  data-testid={`sidebar-menu-${menuItem.id}`}
                  disabled={menuItem.enabled === false}
                  onClick={menuItem.onSelect}>
                  {menuItem.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </>
    )
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'common.search') return 'Search'
      return options?.defaultValue ?? key
    }
  })
}))

import { resolveSidebarAppTabEntryUrl } from '@renderer/utils/sidebar'

import Sidebar from '../Sidebar'

const appFavorite = (id: SidebarAppId): SidebarFavoriteItem => ({ type: 'app', id })
const miniAppFavorite = (id: string): SidebarFavoriteItem => ({ type: 'mini_app', id })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.sidebarFavorites = [appFavorite('assistants')]
  mocks.sidebarMiniAppFavorites = []
  mocks.setSidebarFavorites.mockReset()
  mocks.setSidebarFavorites.mockResolvedValue(undefined)
  mocks.reorderMiniAppsByStatus.mockReset()
  mocks.reorderMiniAppsByStatus.mockResolvedValue(undefined)
  mocks.activeTab = {
    id: 'chat',
    type: 'route',
    url: '/app/chat',
    title: 'Chat'
  }
  mocks.tabs = []
  mocks.allApps = []
  mocks.visibleMiniApps = null
  mocks.pinnedMiniApps = []
  mocks.sidebarWidth = 50
  vi.useRealTimers()
  document.documentElement.style.removeProperty('--sidebar-width')
})

describe('app Sidebar', () => {
  it('uses the user avatar as the header logo and moves footer actions out of the tab bar', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-logo')).toContainElement(screen.getByTestId('sidebar-user-avatar'))
    expect(screen.getByTestId('sidebar-title')).toHaveTextContent('JD')
    expect(screen.getByTestId('sidebar-footer-user')).toHaveTextContent('none')
    expect(screen.getByTestId('sidebar-shell-actions-icon')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'JD' }))

    expect(mocks.showUserPopup).toHaveBeenCalledTimes(1)
  })

  it('opens settings in a main-window tab from the sidebar footer action', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('sidebar-shell-actions-icon'))

    expect(mocks.openTab).toHaveBeenCalledWith('/settings/provider', { title: 'settings.title' })
  })

  it('derives conversation detach URLs from instance metadata', () => {
    expect(
      resolveSidebarAppTabEntryUrl({
        url: '/app/chat?topicId=entry-topic',
        metadata: { instanceAppId: 'assistants', instanceKey: 'current-topic' }
      })
    ).toBe('/app/chat?topicId=current-topic')
    expect(
      resolveSidebarAppTabEntryUrl({
        url: '/app/agents?sessionId=entry-session',
        metadata: { instanceAppId: 'agents', instanceKey: 'current-session' }
      })
    ).toBe('/app/agents?sessionId=current-session')
  })

  it('keeps a message-only detach URL when there is no normal instance key', () => {
    expect(
      resolveSidebarAppTabEntryUrl({
        url: '/app/chat?topicId=t-1&view=message',
        metadata: { instanceAppId: 'assistants', instanceKey: 'stale-topic' }
      })
    ).toBe('/app/chat?topicId=t-1&view=message')
  })

  it('renders sidebar menu items in visible preference order', () => {
    mocks.sidebarFavorites = [appFavorite('translate'), appFavorite('assistants'), appFavorite('agents')]

    render(<Sidebar />)

    const labels = Array.from(screen.getByTestId('sidebar-items').querySelectorAll('span')).map(
      (element) => element.textContent
    )
    expect(labels).toEqual(['Translate', 'Chat', 'Work'])
  })

  it('removes a sidebar app favorite from the context menu', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('knowledge'), appFavorite('files')]

    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-menu-sidebar.remove-app.knowledge')).toHaveTextContent(
      'launchpad.unpin_from_sidebar'
    )

    fireEvent.click(screen.getByTestId('sidebar-menu-sidebar.remove-app.knowledge'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([appFavorite('assistants'), appFavorite('files')])
  })

  it('keeps required sidebar favorites protected in the context menu', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-menu-sidebar.remove-app.assistants')).toBeDisabled()

    fireEvent.click(screen.getByTestId('sidebar-menu-sidebar.remove-app.assistants'))

    expect(mocks.setSidebarFavorites).not.toHaveBeenCalled()
  })

  it('renders favorite mini apps directly in the sidebar mini app section', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator'), miniAppFavorite('weather')]
    mocks.allApps = [
      { appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' },
      { appId: 'weather', name: 'Weather', logo: 'weather-logo', url: 'https://weather.example' }
    ]
    mocks.activeTab = {
      id: 'calculator-tab',
      type: 'route',
      url: '/app/mini-app/calculator',
      title: 'Calculator'
    }

    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-mini-app-section')).toContainElement(
      screen.getByTestId('sidebar-mini-app-calculator')
    )
    expect(screen.getByTestId('sidebar-mini-app-calculator')).toHaveTextContent('Calculator')
    expect(screen.getByTestId('sidebar-mini-app-calculator')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('sidebar-mini-app-weather')).toHaveTextContent('Weather')
    expect(
      Array.from(screen.getByTestId('sidebar-mini-app-section').querySelectorAll('button')).map(
        (button) => button.textContent
      )
    ).toEqual(['Calculator', 'launchpad.unpin_from_sidebar', 'Weather', 'launchpad.unpin_from_sidebar'])
  })

  it('removes a sidebar mini app favorite from the context menu', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator'), miniAppFavorite('weather')]
    mocks.allApps = [
      { appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' },
      { appId: 'weather', name: 'Weather', logo: 'weather-logo', url: 'https://weather.example' }
    ]

    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('sidebar-menu-sidebar.remove-mini-app.calculator'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      appFavorite('assistants'),
      appFavorite('mini_app'),
      miniAppFavorite('weather')
    ])
  })

  it('reorders sidebar favorites through a single mixed drag', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('knowledge'), appFavorite('files')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]

    render(<Sidebar />)
    // Mixed list is [assistants, knowledge, files, calculator]; drag files to front.
    act(() => mocks.onEntriesReorder?.({ oldIndex: 2, newIndex: 0 }))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      appFavorite('files'),
      appFavorite('assistants'),
      appFavorite('knowledge'),
      miniAppFavorite('calculator')
    ])
  })

  it('reorders sidebar mini apps through favorites without touching the mini app order key', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator'), miniAppFavorite('weather')]
    mocks.allApps = [
      { appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' },
      { appId: 'weather', name: 'Weather', logo: 'weather-logo', url: 'https://weather.example' }
    ]

    render(<Sidebar />)
    // Mixed list is [assistants, mini_app, calculator, weather]; drag weather above calculator.
    act(() => mocks.onEntriesReorder?.({ oldIndex: 3, newIndex: 2 }))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      appFavorite('assistants'),
      appFavorite('mini_app'),
      miniAppFavorite('weather'),
      miniAppFavorite('calculator')
    ])
    // The sidebar owns its order through favorites only — the mini app order key
    // (shared with the mini apps grid) is left untouched.
    expect(mocks.reorderMiniAppsByStatus).not.toHaveBeenCalled()
  })

  it('drag-reorders a mini app above a built-in app, interleaving the two types', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]

    render(<Sidebar />)
    // Mixed list is [assistants, mini_app, calculator]; drag calculator to the very top.
    act(() => mocks.onEntriesReorder?.({ oldIndex: 2, newIndex: 0 }))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      miniAppFavorite('calculator'),
      appFavorite('assistants'),
      appFavorite('mini_app')
    ])
  })

  it('does not render mini apps unless they are sidebar favorites', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]

    render(<Sidebar />)

    expect(screen.queryByTestId('sidebar-mini-app-calculator')).not.toBeInTheDocument()
  })

  it('drops stale mini app ids from sidebar favorites', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator'), miniAppFavorite('stale')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]

    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-mini-app-calculator')).toHaveTextContent('Calculator')
    expect(screen.queryByTestId('sidebar-mini-app-stale')).not.toBeInTheDocument()
  })

  it('does not render hidden mini apps left in sidebar favorites', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]
    mocks.visibleMiniApps = []

    render(<Sidebar />)

    expect(screen.queryByTestId('sidebar-mini-app-calculator')).not.toBeInTheDocument()
  })

  it('reuses the active tab from the sidebar mini app section', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat?topicId=t-1',
      title: 'Topic',
      icon: 'emoji:🍒',
      metadata: { instanceAppId: 'assistants', instanceKey: 't-1', keep: true }
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-mini-app-calculator'))

    expect(mocks.updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/mini-app/calculator',
      title: 'Calculator',
      icon: 'calculator-logo',
      metadata: { keep: true }
    })
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('does nothing when the active tab is already on the target mini app route', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]
    mocks.activeTab = {
      id: 'calculator-tab',
      type: 'route',
      url: '/app/mini-app/calculator',
      title: 'Calculator'
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-mini-app-calculator'))

    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('opens a forced mini app tab when the active tab is pinned', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [{ appId: 'calculator', name: 'Calculator', logo: 'calculator-logo', url: 'https://calc.example' }]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat',
      isPinned: true
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-mini-app-calculator'))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/calculator', {
      forceNew: true,
      title: 'Calculator',
      icon: 'calculator-logo'
    })
    expect(mocks.updateTab).not.toHaveBeenCalled()
  })

  it('does nothing when the active tab is already on the target route', () => {
    mocks.sidebarFavorites = [appFavorite('agents')]
    mocks.activeTab = {
      id: 'agents',
      type: 'route',
      url: '/app/agents',
      title: 'Work'
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
  })

  it('reuses the active tab even when another sidebar app tab exists', () => {
    mocks.sidebarFavorites = [appFavorite('agents')]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    }
    mocks.tabs = [{ id: 'agents-1', type: 'route', url: '/app/agents?sessionId=s-1', title: 'Session 1' }]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/agents',
      title: 'Work',
      icon: undefined,
      metadata: undefined
    })
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'chat' })
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('clears stale instance metadata when reusing the active tab', () => {
    mocks.sidebarFavorites = [appFavorite('translate')]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat?topicId=t-1',
      title: 'Topic',
      icon: 'emoji:🍒',
      metadata: { instanceAppId: 'assistants', instanceKey: 't-1', keep: true }
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-translate'))

    expect(mocks.updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/translate',
      title: 'Translate',
      icon: undefined,
      metadata: { keep: true }
    })
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
  })

  it('reuses the active tab for single-policy routes too', () => {
    mocks.sidebarFavorites = [appFavorite('translate')]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-translate'))

    expect(mocks.updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/translate',
      title: 'Translate',
      icon: undefined,
      metadata: undefined
    })
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('opens a forced tab when the active tab is pinned', () => {
    mocks.sidebarFavorites = [appFavorite('agents')]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat',
      isPinned: true
    }
    mocks.openTab.mockReturnValue('agents-new')

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/agents', { forceNew: true, title: 'Work' })
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'agents-new' })
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('opens a forced tab when there is no active tab', () => {
    mocks.sidebarFavorites = [appFavorite('files')]
    mocks.activeTab = null
    mocks.openTab.mockReturnValue('files-new')

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-files'))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/files', { forceNew: true, title: 'Files' })
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
  })

  it('migrates a persisted intermediate sidebar width to icon width and converges', () => {
    mocks.sidebarWidth = 80

    const { rerender } = render(<Sidebar />)

    expect(mocks.sidebarWidth).toBe(50)
    expect(mocks.setSidebarWidth).toHaveBeenCalledTimes(1)

    rerender(<Sidebar />)

    expect(mocks.sidebarWidth).toBe(50)
    expect(mocks.setSidebarWidth).toHaveBeenCalledTimes(1)
  })

  it('uses the resize preview width for rendering and CSS variable without persisting it', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('ui-sidebar')).toHaveAttribute('data-width', '50')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('50px')

    fireEvent.click(screen.getByTestId('preview-80'))

    expect(screen.getByTestId('ui-sidebar')).toHaveAttribute('data-width', '80')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('80px')
    expect(mocks.sidebarWidth).toBe(50)
    expect(mocks.setSidebarWidth).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('preview-null'))

    expect(screen.getByTestId('ui-sidebar')).toHaveAttribute('data-width', '50')
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('50px')
  })
})
