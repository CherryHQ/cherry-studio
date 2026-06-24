// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  showUserPopup: vi.fn(),
  sidebarWidth: 50,
  tabs: [] as FakeTab[],
  sidebarFavorites: ['assistants'] as string[]
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
    if (key === 'ui.sidebar.favorites') return [mocks.sidebarFavorites]
    return [undefined]
  }
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'logo.png'
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => undefined
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ defaultPaintingProvider: undefined })
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

vi.mock('@renderer/components/chat/resources/resourceListRevealEvents', () => ({
  emitResourceListReveal: mocks.emitResourceListReveal
}))

vi.mock('../../../hooks/useTabs', () => ({
  useTabs: () => ({
    activeTab: mocks.activeTab,
    tabs: mocks.tabs,
    openTab: mocks.openTab,
    updateTab: mocks.updateTab,
    setActiveTab: mocks.setActiveTab
  })
}))

vi.mock('@renderer/context/TabsContext', () => ({
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

vi.mock('../../Icons/SVGIcon', () => ({
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

vi.mock('../../Sidebar', () => ({
  Sidebar: ({
    isFloating,
    isFloatingClosing,
    onDismiss,
    onHoverChange,
    onItemClick,
    items,
    title,
    logo,
    user,
    actions,
    width,
    onResizePreview
  }: {
    isFloating?: boolean
    isFloatingClosing?: boolean
    items?: Array<{ id: string; label: string }>
    title?: string
    logo?: ReactNode
    user?: unknown
    actions?: ReactNode | ((layout: 'icon' | 'full') => ReactNode)
    width?: number
    onResizePreview?: (width: number | null) => void
    onDismiss?: () => void
    onHoverChange?: (hovering: boolean) => void
    onItemClick?: (id: string) => void
  }) =>
    isFloating ? (
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
            <button
              key={item.id}
              type="button"
              data-testid={`sidebar-item-${item.id}`}
              onClick={() => onItemClick?.(item.id)}>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </>
    )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'common.search') return 'Search'
      return options?.defaultValue ?? key
    }
  })
}))

import { resolveSidebarAppTabEntryUrl } from '@renderer/config/sidebar'

import Sidebar from '../Sidebar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.sidebarFavorites = ['assistants']
  mocks.activeTab = {
    id: 'chat',
    type: 'route',
    url: '/app/chat',
    title: 'Chat'
  }
  mocks.tabs = []
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
    mocks.sidebarFavorites = ['translate', 'assistants', 'agents']

    render(<Sidebar />)

    const labels = Array.from(screen.getByTestId('sidebar-items').querySelectorAll('span')).map(
      (element) => element.textContent
    )
    expect(labels).toEqual(['Translate', 'Chat', 'Work'])
  })

  it('does nothing when the active tab is already on the target route', () => {
    mocks.sidebarFavorites = ['agents']
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

  it('focuses an existing sidebar app tab instead of reusing the active tab', () => {
    mocks.sidebarFavorites = ['agents']
    mocks.activeTab = {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    }
    mocks.tabs = [{ id: 'agents-1', type: 'route', url: '/app/agents?sessionId=s-1', title: 'Session 1' }]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('agents-1')
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'agents-1' })
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('clears stale instance metadata when reusing the active tab', () => {
    mocks.sidebarFavorites = ['translate']
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
    mocks.sidebarFavorites = ['translate']
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
    mocks.sidebarFavorites = ['agents']
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
    mocks.sidebarFavorites = ['files']
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
