// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  tabs: [] as FakeTab[],
  visibleSidebarIcons: ['assistants'] as string[]
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [0, mocks.setSidebarWidth]
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.user.name') return ['JD']
    if (key === 'ui.sidebar.icons.visible') return [mocks.visibleSidebarIcons]
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
  getSidebarIconLabel: (icon: string) =>
    ({
      agents: 'Agent',
      assistants: 'Chat',
      translate: 'Translate'
    })[icon]
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (url: string) =>
    ({
      '/app/agents': 'Agent',
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
    show: vi.fn()
  }
}))

vi.mock('../../Icons/SVGIcon', () => ({
  OpenClawSidebarIcon: () => null
}))

vi.mock('../../Sidebar', () => ({
  Sidebar: ({
    isFloating,
    isFloatingClosing,
    onDismiss,
    onHoverChange,
    onItemClick,
    items
  }: {
    isFloating?: boolean
    isFloatingClosing?: boolean
    items?: Array<{ id: string; label: string }>
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
        <button type="button" onClick={() => onHoverChange?.(true)}>
          reveal
        </button>
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
  mocks.visibleSidebarIcons = ['assistants']
  mocks.activeTab = {
    id: 'chat',
    type: 'route',
    url: '/app/chat',
    title: 'Chat'
  }
  mocks.tabs = []
  vi.useRealTimers()
})

describe('app Sidebar', () => {
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

  it('keeps the floating sidebar mounted for its closing animation before unmounting', () => {
    vi.useFakeTimers()
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'reveal' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-in', 'slide-in-from-left-2')

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-out', 'slide-out-to-left-2')

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByTestId('floating-sidebar')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('floating-sidebar')).not.toBeInTheDocument()
  })

  it('renders sidebar menu items in visible preference order', () => {
    mocks.visibleSidebarIcons = ['translate', 'assistants', 'agents']

    render(<Sidebar />)

    const labels = Array.from(screen.getByTestId('sidebar-items').querySelectorAll('span')).map(
      (element) => element.textContent
    )
    expect(labels).toEqual(['Translate', 'Chat', 'Agent'])
  })

  it('does nothing when the active tab is already on the target route', () => {
    mocks.visibleSidebarIcons = ['agents']
    mocks.activeTab = {
      id: 'agents',
      type: 'route',
      url: '/app/agents',
      title: 'Agent'
    }

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
  })

  it('focuses an existing sidebar app tab instead of reusing the active tab', () => {
    mocks.visibleSidebarIcons = ['agents']
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
    mocks.visibleSidebarIcons = ['translate']
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
    mocks.visibleSidebarIcons = ['translate']
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
    mocks.visibleSidebarIcons = ['agents']
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

    expect(mocks.openTab).toHaveBeenCalledWith('/app/agents', { forceNew: true, title: 'Agent' })
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'agents-new' })
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('opens a forced tab when there is no active tab', () => {
    mocks.visibleSidebarIcons = ['files']
    mocks.activeTab = null
    mocks.openTab.mockReturnValue('files-new')

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-files'))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/files', { forceNew: true, title: 'Files' })
    expect(mocks.updateTab).not.toHaveBeenCalled()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.emitResourceListReveal).not.toHaveBeenCalled()
  })
})
