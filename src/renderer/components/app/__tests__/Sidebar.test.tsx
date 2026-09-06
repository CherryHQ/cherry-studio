// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { SidebarAppId } from '@renderer/utils/sidebar'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as SidebarConstants from '../../Sidebar/constants'

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

type FakeAgent = {
  id: string
  name: string
}

type FakeAssistant = {
  id: string
  name: string
}

const mocks = vi.hoisted(() => ({
  emitResourceListReveal: vi.fn(),
  openTab: vi.fn(),
  openSettingsTab: vi.fn(),
  setActiveTab: vi.fn(),
  useMiniApps: vi.fn(),
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
  sidebarAgentFavorites: [] as SidebarFavoriteItem[],
  sidebarAssistantFavorites: [] as SidebarFavoriteItem[],
  agents: [] as FakeAgent[],
  assistants: [] as FakeAssistant[],
  allApps: [] as FakeMiniApp[],
  visibleMiniApps: null as FakeMiniApp[] | null,
  pinnedMiniApps: [] as FakeMiniApp[],
  onEntriesReorder: undefined as ((event: { oldIndex: number; newIndex: number }) => void) | undefined
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => {
    return [
      mocks.sidebarWidth,
      (width: number) => {
        mocks.sidebarWidth = width
        mocks.setSidebarWidth(width)
      }
    ]
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.user.name') return ['JD']
    if (key === 'ui.sidebar.favorites')
      return [
        [
          ...mocks.sidebarFavorites,
          ...mocks.sidebarMiniAppFavorites,
          ...mocks.sidebarAgentFavorites,
          ...mocks.sidebarAssistantFavorites
        ],
        mocks.setSidebarFavorites
      ]
    return [undefined]
  }
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({
    agents: mocks.agents
  })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistantsApi: () => ({
    assistants: mocks.assistants
  })
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => undefined
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: (options?: { enabled?: boolean }) => {
    mocks.useMiniApps(options)
    return {
      allApps: mocks.allApps,
      miniApps: mocks.visibleMiniApps ?? mocks.allApps,
      pinned: mocks.pinnedMiniApps,
      reorderMiniAppsByStatus: mocks.reorderMiniAppsByStatus
    }
  }
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
      '/app/launchpad': 'Launchpad',
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

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('../../UserAccountPanel', () => ({
  UserAccountPanel: () => <div data-testid="account-menu">account-menu</div>
}))

vi.mock('../../icons/SvgIcon', () => ({
  OpenClawSidebarIcon: () => null
}))

vi.mock('../../feedback/FeedbackDialog', () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
    <div data-testid="feedback-shell" data-open={open}>
      {open ? <div role="dialog">feedback-dialog</div> : null}
      <button type="button" onClick={() => onOpenChange(false)}>
        close-feedback
      </button>
    </div>
  )
}))

vi.mock('../../layout/ShellTabBarActions', () => ({
  SidebarShellActions: ({
    layout,
    onFeedbackClick,
    onSettingsClick
  }: {
    layout: string
    onFeedbackClick: () => void
    onSettingsClick: () => void
  }) => (
    <>
      <button type="button" data-testid={`sidebar-shell-actions-${layout}`} onClick={onSettingsClick} />
      <button type="button" data-testid={`sidebar-feedback-${layout}`} onClick={onFeedbackClick} />
    </>
  )
}))

type MockSidebarEntry = {
  key: string
  label: string
  isActive: (active: { activeItem: string; activeTabId?: string }) => boolean
  onOpen: () => void
  onOpenNewTab?: () => void
  contextMenuItems?: Array<{ id: string; label: string; enabled?: boolean; onSelect?: () => void }>
}

const parseEntryKey = (key: string) => {
  const idx = key.indexOf(':')
  return { type: key.slice(0, idx), id: key.slice(idx + 1) }
}

vi.mock('../../Sidebar', async () => {
  const constants = await vi.importActual<typeof SidebarConstants>('../../Sidebar/constants')
  return {
    ...constants,
    UserAvatar: ({ user, className }: { user: { name: string }; className?: string }) => (
      <div className={className} data-testid="sidebar-user-avatar">
        {user.name}
      </div>
    ),
    MiniAppIcon: () => null,
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
      onHeaderClick,
      renderHeaderTrigger,
      renderHeaderAnchor,
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
      onHeaderClick?: () => void
      renderHeaderTrigger?: (trigger: ReactElement) => ReactElement
      renderHeaderAnchor?: (anchor: ReactElement) => ReactNode
      user?: unknown
      actions?: ReactNode | ((layout: 'icon' | 'full', onOverlayOpenChange?: (open: boolean) => void) => ReactNode)
      width?: number
      onResizePreview?: (width: number | null) => void
      onDismiss?: () => void
      onHoverChange?: (hovering: boolean) => void
      onEntriesReorder?: (event: { oldIndex: number; newIndex: number }) => void
    }) => {
      mocks.onEntriesReorder = onEntriesReorder
      if (!isFloating && constants.getSidebarLayout(width ?? 0) === 'hidden') {
        return (
          <button type="button" onClick={() => onHoverChange?.(true)}>
            reveal
          </button>
        )
      }

      // Entries are type-agnostic resolved rows; the tests still assert per-type
      // testids, so recover the type/id from the stable `entry.key` (`${type}:${id}`).
      const activeState = active ?? { activeItem: '' }
      const items = entries?.filter((entry) => parseEntryKey(entry.key).type === 'app')
      const dockedTabs = entries?.filter((entry) => parseEntryKey(entry.key).type === 'mini_app')
      const agentItems = entries?.filter((entry) => parseEntryKey(entry.key).type === 'agent')
      const assistantItems = entries?.filter((entry) => parseEntryKey(entry.key).type === 'assistant')
      const renderHeader = (layout: 'icon' | 'full', prefix: 'sidebar' | 'floating-sidebar') => {
        const action = (
          <button type="button" aria-label={title} onClick={onHeaderClick}>
            <div data-testid={`${prefix}-logo`}>{logo}</div>
            <div data-testid={prefix === 'sidebar' ? 'sidebar-title' : undefined}>{title}</div>
          </button>
        )
        const trigger = renderHeaderTrigger?.(action) ?? action
        const row = <div data-testid={`${prefix}-header`}>{trigger}</div>

        if (!renderHeaderAnchor) return row
        return layout === 'full' ? renderHeaderAnchor(row) : <div>{renderHeaderAnchor(trigger)}</div>
      }

      return isFloating ? (
        <div
          className={isFloatingClosing ? 'slide-out-to-left-2 animate-out' : 'slide-in-from-left-2 animate-in'}
          data-testid="floating-sidebar">
          {renderHeader('full', 'floating-sidebar')}
          {typeof actions === 'function' ? actions('full') : actions}
          <button type="button" onClick={onDismiss}>
            dismiss
          </button>
        </div>
      ) : (
        <>
          {renderHeader(constants.getSidebarLayout(width ?? 0) === 'full' ? 'full' : 'icon', 'sidebar')}
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
              <div key={item.key} role="group" aria-label={item.label}>
                <button
                  type="button"
                  data-testid={`sidebar-item-${parseEntryKey(item.key).id}`}
                  onClick={() => item.onOpen()}
                  onAuxClick={(e) => {
                    if (e.button === 1) item.onOpenNewTab?.()
                  }}>
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
              <div key={miniTab.key} role="group" aria-label={miniTab.label}>
                <button
                  type="button"
                  data-active={miniTab.isActive(activeState) ? 'true' : 'false'}
                  data-testid={`sidebar-mini-app-${parseEntryKey(miniTab.key).id}`}
                  onClick={() => miniTab.onOpen()}
                  onAuxClick={(e) => {
                    if (e.button === 1) miniTab.onOpenNewTab?.()
                  }}>
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
          <div data-testid="sidebar-agent-section">
            {agentItems?.map((agentItem) => (
              <div key={agentItem.key} role="group" aria-label={agentItem.label}>
                <button
                  type="button"
                  data-testid={`sidebar-agent-${parseEntryKey(agentItem.key).id}`}
                  onClick={() => agentItem.onOpen()}
                  onAuxClick={(e) => {
                    if (e.button === 1) agentItem.onOpenNewTab?.()
                  }}>
                  {agentItem.label}
                </button>
                {agentItem.contextMenuItems?.map((menuItem) => (
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
          <div data-testid="sidebar-assistant-section">
            {assistantItems?.map((assistantItem) => (
              <div key={assistantItem.key} role="group" aria-label={assistantItem.label}>
                <button
                  type="button"
                  data-testid={`sidebar-assistant-${parseEntryKey(assistantItem.key).id}`}
                  onClick={() => assistantItem.onOpen()}
                  onAuxClick={(e) => {
                    if (e.button === 1) assistantItem.onOpenNewTab?.()
                  }}>
                  {assistantItem.label}
                </button>
                {assistantItem.contextMenuItems?.map((menuItem) => (
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
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'common.search') return 'Search'
      if (key === 'launchpad.manage_sidebar') return 'Manage Sidebar'
      return options?.defaultValue ?? key
    }
  })
}))

import Sidebar from '../Sidebar'

const appFavorite = (id: SidebarAppId): SidebarFavoriteItem => ({ type: 'app', id })
const miniAppFavorite = (id: string): SidebarFavoriteItem => ({ type: 'mini_app', id })
const agentFavorite = (id: string): SidebarFavoriteItem => ({ type: 'agent', id })
const assistantFavorite = (id: string): SidebarFavoriteItem => ({ type: 'assistant', id })
const calculatorMiniApp: FakeMiniApp = {
  appId: 'calculator',
  name: 'Calculator',
  logo: 'calculator-logo',
  url: 'https://calc.example'
}
const weatherMiniApp: FakeMiniApp = {
  appId: 'weather',
  name: 'Weather',
  logo: 'weather-logo',
  url: 'https://weather.example'
}

function configureMiniApps(favoriteIds: string[], apps: FakeMiniApp[] = [calculatorMiniApp]) {
  mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]
  mocks.sidebarMiniAppFavorites = favoriteIds.map(miniAppFavorite)
  mocks.allApps = apps
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.sidebarFavorites = [appFavorite('assistants')]
  mocks.sidebarMiniAppFavorites = []
  mocks.sidebarAgentFavorites = []
  mocks.sidebarAssistantFavorites = []
  mocks.agents = []
  mocks.assistants = []
  mocks.setSidebarFavorites.mockReset()
  mocks.setSidebarFavorites.mockResolvedValue(undefined)
  mocks.reorderMiniAppsByStatus.mockReset()
  mocks.reorderMiniAppsByStatus.mockResolvedValue(undefined)
  mocks.useMiniApps.mockReset()
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
  it('loads mini apps only when the sidebar contains a custom mini-app favorite', () => {
    const view = render(<Sidebar />)
    expect(mocks.useMiniApps).toHaveBeenLastCalledWith({ enabled: false })

    mocks.sidebarMiniAppFavorites = [miniAppFavorite('mini-1')]
    view.rerender(<Sidebar />)

    expect(mocks.useMiniApps).toHaveBeenLastCalledWith({ enabled: true })
  })

  it('opens the account menu at the avatar instead of launching the centered user popup', async () => {
    const user = userEvent.setup()
    const { container } = render(<Sidebar />)

    expect(container.querySelector('#app-sidebar')).toHaveAttribute('data-ui', 'app.sidebar')
    expect(screen.getByTestId('sidebar-logo')).toContainElement(screen.getByTestId('sidebar-user-avatar'))
    expect(screen.getByTestId('sidebar-title')).toHaveTextContent('JD')
    expect(screen.getByTestId('sidebar-footer-user')).toHaveTextContent('none')
    expect(screen.getByTestId('sidebar-shell-actions-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('sidebar-title'))

    expect(screen.getByTestId('account-menu')).toBeVisible()
    expect(mocks.showUserPopup).not.toHaveBeenCalled()
  })

  it('opens settings in a main-window tab from the sidebar footer action', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('sidebar-shell-actions-icon'))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith()
  })

  it('keeps feedback mounted when the floating sidebar closes', async () => {
    const user = userEvent.setup()
    mocks.sidebarWidth = 0
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'reveal' }))
    const floatingSidebar = screen.getByTestId('floating-sidebar')
    await user.click(within(floatingSidebar).getByTestId('sidebar-feedback-full'))

    expect(await screen.findByRole('dialog')).toHaveTextContent('feedback-dialog')

    await user.click(within(floatingSidebar).getByRole('button', { name: 'dismiss' }))

    expect(screen.queryByTestId('floating-sidebar')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('feedback-dialog')

    await user.click(screen.getByRole('button', { name: 'close-feedback' }))
    expect(screen.getByTestId('feedback-shell')).toHaveAttribute('data-open', 'false')
  })

  it('keeps a floating sidebar open while its account menu is in use', async () => {
    const user = userEvent.setup()
    mocks.sidebarWidth = 0
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'reveal' }))
    const floatingSidebar = screen.getByTestId('floating-sidebar')
    await user.click(within(floatingSidebar).getByRole('button', { name: 'JD' }))

    expect(screen.getByTestId('account-menu')).toBeVisible()
    await user.click(within(floatingSidebar).getByRole('button', { name: 'dismiss' }))
    expect(screen.getByTestId('floating-sidebar')).toBeVisible()

    await user.click(within(floatingSidebar).getByRole('button', { name: 'JD' }))
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('floating-sidebar')).not.toBeInTheDocument()
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

  it('allows removing the chat assistant from the sidebar when other apps remain', () => {
    mocks.sidebarFavorites = [
      { type: 'app', id: 'assistants' },
      { type: 'app', id: 'knowledge' }
    ]
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-menu-sidebar.remove-app.assistants')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('sidebar-menu-sidebar.remove-app.assistants'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([{ type: 'app', id: 'knowledge' }])
  })

  it('disables removing the last sidebar app', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-menu-sidebar.remove-app.assistants')).toBeDisabled()

    fireEvent.click(screen.getByTestId('sidebar-menu-sidebar.remove-app.assistants'))

    expect(mocks.setSidebarFavorites).not.toHaveBeenCalled()
  })

  it('opens the launchpad in a new tab from the manage sidebar context menu', async () => {
    const user = userEvent.setup()
    mocks.sidebarFavorites = [appFavorite('knowledge')]

    render(<Sidebar />)

    const knowledgeItem = screen.getByRole('group', { name: 'knowledge' })
    const manageSidebar = within(knowledgeItem).getByRole('button', { name: 'Manage Sidebar' })

    await user.click(manageSidebar)

    expect(mocks.openTab).toHaveBeenCalledWith('/app/launchpad', {
      forceNew: true,
      title: 'Launchpad'
    })
  })

  it('renders favorite mini apps directly in the sidebar mini app section', () => {
    configureMiniApps(['calculator', 'weather'], [calculatorMiniApp, weatherMiniApp])
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
      within(screen.getByTestId('sidebar-mini-app-section'))
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-label'))
    ).toEqual(['Calculator', 'Weather'])
  })

  it('removes a sidebar mini app favorite from the context menu', () => {
    configureMiniApps(['calculator', 'weather'], [calculatorMiniApp, weatherMiniApp])

    render(<Sidebar />)

    fireEvent.click(screen.getByTestId('sidebar-menu-sidebar.remove-mini-app.calculator'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      appFavorite('assistants'),
      appFavorite('mini_app'),
      miniAppFavorite('weather')
    ])
  })

  it('offers the manage sidebar action for mini app favorites', () => {
    mocks.sidebarFavorites = []
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [calculatorMiniApp]

    render(<Sidebar />)

    const calculatorItem = screen.getByRole('group', { name: 'Calculator' })
    expect(within(calculatorItem).getByRole('button', { name: 'Manage Sidebar' })).toBeInTheDocument()
  })

  it('reorders sidebar favorites through a single mixed drag', () => {
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('knowledge'), appFavorite('files')]
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('calculator')]
    mocks.allApps = [calculatorMiniApp]

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
    configureMiniApps(['calculator', 'weather'], [calculatorMiniApp, weatherMiniApp])

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
    configureMiniApps(['calculator'])

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
    configureMiniApps([])

    render(<Sidebar />)

    expect(screen.queryByTestId('sidebar-mini-app-calculator')).not.toBeInTheDocument()
  })

  it('drops stale mini app ids from sidebar favorites', () => {
    configureMiniApps(['calculator', 'stale'])

    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-mini-app-calculator')).toHaveTextContent('Calculator')
    expect(screen.queryByTestId('sidebar-mini-app-stale')).not.toBeInTheDocument()
  })

  it('does not render hidden mini apps left in sidebar favorites', () => {
    configureMiniApps(['calculator'])
    mocks.visibleMiniApps = []

    render(<Sidebar />)

    expect(screen.queryByTestId('sidebar-mini-app-calculator')).not.toBeInTheDocument()
  })

  it('reuses the active tab from the sidebar mini app section', () => {
    configureMiniApps(['calculator'])
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat?topicId=t-1',
      title: 'Topic',
      icon: 'emoji:🍒',
      metadata: { keep: true }
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-mini-app-calculator'))

    expect(mocks.updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/mini-app/calculator',
      title: 'Calculator',
      icon: 'calculator-logo',
      metadata: undefined
    })
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('switches to an existing mini app tab without replacing the active tab', async () => {
    const user = userEvent.setup()
    configureMiniApps(['calculator'])
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat?topicId=t-1',
      title: 'Topic'
    }
    mocks.tabs = [
      mocks.activeTab,
      {
        id: 'calculator-tab',
        type: 'route',
        url: '/app/mini-app/calculator',
        title: 'Calculator'
      }
    ]

    render(<Sidebar />)
    await user.click(screen.getByRole('button', { name: 'Calculator' }))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('calculator-tab')
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('keeps the active mini app tab alive when opening another mini app', () => {
    configureMiniApps(['calculator', 'weather'], [calculatorMiniApp, weatherMiniApp])
    mocks.activeTab = {
      id: 'calculator-tab',
      type: 'route',
      url: '/app/mini-app/calculator',
      title: 'Calculator'
    }
    mocks.tabs = [mocks.activeTab]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-mini-app-weather'))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/weather', {
      title: 'Weather',
      icon: 'weather-logo'
    })
    expect(mocks.updateTab).not.toHaveBeenCalled()
  })

  it('does nothing when the active tab is already on the target mini app route', () => {
    configureMiniApps(['calculator'])
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
    configureMiniApps(['calculator'])
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

  it('reuses the active tab without revealing its resource list', () => {
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
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('replaces the active tab with the bare route', () => {
    mocks.sidebarFavorites = [appFavorite('agents')]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat?topicId=topic-1',
      title: 'Chat',
      metadata: { keep: true }
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    // Which session the tab lands on is the route interceptor's decision — the
    // sidebar only replaces the tab with the app's bare entry route.
    expect(mocks.updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/agents',
      title: 'Work',
      icon: undefined,
      metadata: undefined
    })
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('stays put when the active tab already holds a conversation of the target app', () => {
    mocks.sidebarFavorites = [appFavorite('agents')]
    mocks.activeTab = {
      id: 'agents-1',
      type: 'route',
      url: '/app/agents?sessionId=session-1',
      title: 'Session 1'
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    // Re-entering through the interceptor would rebind the tab to the last-used
    // conversation — an owned tab is already "there", whatever session it shows.
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('navigates a message-only viewer of the same app back to the app entry', () => {
    mocks.sidebarFavorites = [appFavorite('agents')]
    mocks.activeTab = {
      id: 'viewer',
      type: 'route',
      url: '/app/agents?sessionId=session-1&view=message',
      title: 'Session 1'
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.updateTab).toHaveBeenCalledWith('viewer', {
      url: '/app/agents',
      title: 'Work',
      icon: undefined,
      metadata: undefined
    })
  })

  it('clears route-specific metadata when reusing the active tab', () => {
    mocks.sidebarFavorites = [appFavorite('translate')]
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat?topicId=t-1',
      title: 'Topic',
      icon: 'emoji:🍒',
      metadata: { keep: true }
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

  it('opens a forced tab without revealing its resource list when the active tab is pinned', () => {
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

    expect(mocks.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Work'
    })
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
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

  it('opens a new tab on middle-click (auxclick with button 1) on an app item', () => {
    mocks.sidebarFavorites = [appFavorite('assistants')]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }

    render(<Sidebar />)
    const button = screen.getByTestId('sidebar-item-assistants')
    fireEvent(button, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat', { forceNew: true, title: 'Chat' })
  })

  it('opens a new tab via context menu "open in new tab" option on an app item', () => {
    mocks.sidebarFavorites = [appFavorite('assistants')]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }

    render(<Sidebar />)
    const menuButton = screen.getByTestId('sidebar-menu-sidebar.open-in-new-tab.app:assistants')
    expect(menuButton).toHaveTextContent('common.open_in_new_tab')

    fireEvent.click(menuButton)
    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat', { forceNew: true, title: 'Chat' })
  })

  it('opens a new tab on middle-click (auxclick with button 1) on a mini app item', () => {
    mocks.sidebarFavorites = []
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('mini-1')]
    mocks.allApps = [{ appId: 'mini-1', name: 'Mini One', logo: 'logo-1.png', url: 'https://example.com/1' }]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }

    render(<Sidebar />)
    const button = screen.getByTestId('sidebar-mini-app-mini-1')
    fireEvent(button, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/mini-1', {
      forceNew: true,
      title: 'Mini One',
      icon: 'logo-1.png'
    })
  })

  it('creates a new mini app tab on middle-click even when a tab already exists', () => {
    mocks.sidebarFavorites = []
    mocks.sidebarMiniAppFavorites = [miniAppFavorite('mini-1')]
    mocks.allApps = [{ appId: 'mini-1', name: 'Mini One', logo: 'logo-1.png', url: 'https://example.com/1' }]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }
    mocks.tabs = [
      mocks.activeTab,
      { id: 'mini-existing', type: 'route', url: '/app/mini-app/mini-1', title: 'Mini One' }
    ]

    render(<Sidebar />)
    const button = screen.getByTestId('sidebar-mini-app-mini-1')
    fireEvent(button, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/mini-1', {
      forceNew: true,
      title: 'Mini One',
      icon: 'logo-1.png'
    })
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.updateTab).not.toHaveBeenCalled()
  })

  it('opens a new tab on middle-click (auxclick with button 1) on an agent item', () => {
    mocks.sidebarFavorites = []
    mocks.sidebarAgentFavorites = [agentFavorite('agent-1')]
    mocks.agents = [{ id: 'agent-1', name: 'Code Reviewer' }]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }

    render(<Sidebar />)
    const button = screen.getByTestId('sidebar-agent-agent-1')
    fireEvent(button, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/agents?agentId=agent-1', {
      forceNew: true,
      title: 'Code Reviewer'
    })
  })

  it('opens a new tab via context menu "open in new tab" option on an agent item', () => {
    mocks.sidebarFavorites = []
    mocks.sidebarAgentFavorites = [agentFavorite('agent-1')]
    mocks.agents = [{ id: 'agent-1', name: 'Code Reviewer' }]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }

    render(<Sidebar />)
    const menuButton = screen.getByTestId('sidebar-menu-sidebar.open-in-new-tab.agent:agent-1')
    expect(menuButton).toHaveTextContent('common.open_in_new_tab')

    fireEvent.click(menuButton)
    expect(mocks.openTab).toHaveBeenCalledWith('/app/agents?agentId=agent-1', {
      forceNew: true,
      title: 'Code Reviewer'
    })
  })

  it('opens a new tab on middle-click (auxclick with button 1) on an assistant item', () => {
    mocks.sidebarFavorites = []
    mocks.sidebarAssistantFavorites = [assistantFavorite('assistant-1')]
    mocks.assistants = [{ id: 'assistant-1', name: 'Helper' }]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }

    render(<Sidebar />)
    const button = screen.getByTestId('sidebar-assistant-assistant-1')
    fireEvent(button, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat?assistantId=assistant-1', {
      forceNew: true,
      title: 'Helper'
    })
  })

  it('opens a new tab via context menu "open in new tab" option on an assistant item', () => {
    mocks.sidebarFavorites = []
    mocks.sidebarAssistantFavorites = [assistantFavorite('assistant-1')]
    mocks.assistants = [{ id: 'assistant-1', name: 'Helper' }]
    mocks.activeTab = { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }

    render(<Sidebar />)
    const menuButton = screen.getByTestId('sidebar-menu-sidebar.open-in-new-tab.assistant:assistant-1')
    expect(menuButton).toHaveTextContent('common.open_in_new_tab')

    fireEvent.click(menuButton)
    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat?assistantId=assistant-1', {
      forceNew: true,
      title: 'Helper'
    })
  })
})
