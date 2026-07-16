// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ShellTabBarActionsModule from '../ShellTabBarActions'

const mocks = vi.hoisted(() => ({
  emitResourceListReveal: vi.fn(),
  platformState: { isMac: false },
  showSearchPopup: vi.fn()
}))

vi.mock('@renderer/components/GlobalSearch/GlobalSearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('@renderer/services/resourceListRevealEvents', () => ({
  emitResourceListReveal: mocks.emitResourceListReveal
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return mocks.platformState.isMac
  },
  isLinux: false,
  isWin: false,
  platform: 'linux'
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => ({
  getMiniAppsLogoRef: () => undefined,
  useMiniAppLogo: () => undefined
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false]
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ settedTheme: 'light', toggleTheme: vi.fn() })
}))

vi.mock('@renderer/i18n/label', () => ({
  getThemeModeLabel: () => 'Light'
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

vi.mock('../ShellTabBarActions', async () => {
  const actual = await vi.importActual<typeof ShellTabBarActionsModule>('../ShellTabBarActions')
  return {
    ...actual,
    ShellTabBarActions: () => null
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => (key === 'title.launchpad' ? 'Launchpad' : key)
  })
}))

// Render the command context menu's extra items inline as buttons so each tab's
// "move to first" action is directly clickable without driving the real menu.
vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems
  }: {
    children: ReactNode
    extraItems?: Array<{ id: string; label: string; onSelect?: () => void }>
  }) => (
    <div>
      {children}
      {extraItems?.map((item) => (
        <button key={item.id} type="button" data-testid={`menu-${item.id}`} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  CommandTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { AppShellTabBar, getTabCapabilities } from '../AppShellTabBar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.platformState.isMac = false
})

describe('AppShellTabBar', () => {
  const renderTabBar = (
    props?: Partial<ComponentProps<typeof AppShellTabBar>>,
    wrapperProps?: ComponentProps<'div'>
  ) => {
    const closeTab = vi.fn()
    const tabs: Tab[] = props?.tabs ?? [
      { id: 'home', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' }
    ]

    render(
      <div {...wrapperProps}>
        <AppShellTabBar
          tabs={tabs}
          activeTabId={tabs[0]?.id ?? 'home'}
          setActiveTab={vi.fn()}
          reorderTabs={vi.fn()}
          pinTab={vi.fn()}
          unpinTab={vi.fn()}
          openTab={vi.fn()}
          {...props}
          closeTab={closeTab}
        />
      </div>
    )

    return closeTab
  }
  it('opens launchpad from the plus button', async () => {
    const user = userEvent.setup()
    const openTab = vi.fn()
    const tabs: Tab[] = [
      {
        id: 'home',
        type: 'route',
        url: '/app/chat',
        title: 'Chat'
      }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={openTab}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Launchpad' }))

    expect(openTab).toHaveBeenCalledWith('/app/launchpad', { title: 'Launchpad', forceNew: true })
  })

  it('moves a normal tab to the first slot', async () => {
    const user = userEvent.setup()
    const reorderTabs = vi.fn()
    const tabs: Tab[] = [
      { id: 'home', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' },
      { id: 'b', type: 'route', url: '/app/b', title: 'B' }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={reorderTabs}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    const moveButtons = screen.getAllByTestId('menu-tab.move-to-first')
    expect(moveButtons).toHaveLength(3)
    await user.click(moveButtons[2])

    expect(reorderTabs).toHaveBeenCalledWith('normal', 2, 0)
  })

  it('lets the home tab expose menu affordances like a normal tab', () => {
    const tabs: Tab[] = [
      { id: 'home', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    expect(screen.queryAllByTestId('menu-tab.move-to-first')).toHaveLength(2)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(2)
  })

  it('keeps tab buttons no-drag while leaving tabbar whitespace draggable', () => {
    const tabs: Tab[] = [
      { id: 'home', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' },
      { id: 'p', type: 'route', url: '/app/p', title: 'P', isPinned: true }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="a"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    const tabStrip = screen.getByTestId('app-shell-tab-strip')
    const chatTab = screen.getByRole('button', { name: 'Chat' })
    const normalTab = screen.getByRole('button', { name: 'A' })
    const pinnedTab = screen.getByRole('button', { name: 'P' })

    expect(tabStrip).not.toHaveClass('nodrag')
    expect(tabStrip).not.toHaveClass('[-webkit-app-region:no-drag]')
    expect(chatTab).toHaveClass('nodrag')
    expect(normalTab).toHaveClass('nodrag')
    expect(pinnedTab).toHaveClass('nodrag')
  })

  it('removes the left inset on Windows and Linux without caller configuration', () => {
    const tabs: Tab[] = [{ id: 'home', type: 'route', url: '/app/chat', title: 'Chat' }]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    const header = screen.getByTestId('app-shell-tab-strip').closest('header')
    const tabStrip = screen.getByTestId('app-shell-tab-strip')

    expect(header).toHaveClass('pl-0')
    expect(header).not.toHaveClass('pl-3')
    expect(tabStrip).toHaveClass('pr-1')
    expect(tabStrip).not.toHaveClass('px-1')
    expect(tabStrip).not.toHaveClass('pl-1')
  })

  it('keeps the macOS tab bar flush while tab buttons avoid traffic lights when the sidebar narrows', () => {
    mocks.platformState.isMac = true

    renderTabBar()

    const header = screen.getByTestId('app-shell-tab-strip').closest('header')
    const tabStrip = screen.getByTestId('app-shell-tab-strip')

    expect(header).toHaveClass('pl-0')
    expect(header).not.toHaveClass('pl-[env(titlebar-area-x)]')
    expect(screen.queryByTestId('macos-tab-strip-traffic-light-spacer')).toBeNull()
    expect(tabStrip).toHaveStyle({
      paddingLeft: 'max(0px, calc(env(titlebar-area-x, 0px) - var(--sidebar-width, 0px)))'
    })
    expect(tabStrip).toHaveClass('pr-1')
    expect(tabStrip).not.toHaveClass('pl-1')
  })

  it('removes the macOS traffic light reserve while fullscreen', () => {
    mocks.platformState.isMac = true

    renderTabBar({ isFullscreen: true })

    const header = screen.getByTestId('app-shell-tab-strip').closest('header')
    const tabStrip = screen.getByTestId('app-shell-tab-strip')

    expect(header).toHaveClass('pl-0')
    expect(tabStrip).not.toHaveStyle({
      paddingLeft: 'max(0px, calc(env(titlebar-area-x, 0px) - var(--sidebar-width, 0px)))'
    })
    expect(tabStrip).toHaveClass('pr-1')
  })

  it('slightly enlarges normal tab titles and leading icons without restoring medium weight', () => {
    const fadeMask = 'linear-gradient(to right, black 80%, transparent 100%)'

    renderTabBar({
      tabs: [
        { id: 'chat', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Chat title' },
        { id: 'a', type: 'route', url: '/app/a', title: 'A' }
      ],
      activeTabId: 'chat'
    })

    const title = screen.getByText('Chat title')
    const tabButton = screen.getByRole('button', { name: 'Chat title' })
    const icon = tabButton.querySelector('svg')
    const iconBox = icon?.parentElement

    expect(title).toHaveClass('font-normal')
    expect(title).toHaveClass('text-xs')
    expect(title).toHaveClass('leading-none')
    expect(title).toHaveClass('min-w-0', 'flex-1', 'overflow-hidden', 'whitespace-nowrap')
    expect(title).not.toHaveClass('font-medium')
    expect(title).not.toHaveClass('truncate')
    expect(title.getAttribute('style')).toContain(`mask-image: ${fadeMask}`)
    expect(tabButton).toHaveClass('pl-2', 'pr-1.5')
    expect(tabButton).not.toHaveClass('pr-1')
    expect(icon).toHaveAttribute('width', '14')
    expect(icon).toHaveAttribute('height', '14')
    expect(iconBox).toHaveClass('h-3.5', 'w-3.5')
  })

  it('requests ResourceList reveal when selecting a chat or agent tab from the window tab bar', async () => {
    const setActiveTab = vi.fn()
    const tabs: Tab[] = [
      { id: 'files', type: 'route', url: '/app/files', title: 'Files' },
      { id: 'chat', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Chat' },
      { id: 'agents', type: 'route', url: '/app/agents?sessionId=session-1', title: 'Agent' }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="files"
        setActiveTab={setActiveTab}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(setActiveTab).toHaveBeenCalledWith('chat')
    expect(setActiveTab).toHaveBeenCalledWith('agents')
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'assistants', tabId: 'chat' })
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'agents' })
  })

  it('keeps close and pin menu actions when only a single tab is open', () => {
    const tabs: Tab[] = [{ id: 'home', type: 'route', url: '/app/chat', title: 'Chat' }]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    expect(screen.queryByTestId('menu-tab.move-to-first')).toBeNull()
    expect(screen.queryAllByTestId('menu-tab.pin')).toHaveLength(1)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(1)
  })

  it('allows the last normal tab to close while forbidding direct close on pinned tabs', () => {
    const tabs: Tab[] = [
      { id: 'home', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'p', type: 'route', url: '/app/p', title: 'P', isPinned: true }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    expect(screen.queryAllByTestId('menu-tab.pin')).toHaveLength(2)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(1)
    expect(screen.queryAllByTestId('menu-tab.move-to-first')).toHaveLength(0)
  })

  it('allows closing normal tabs while more than one normal tab is open', () => {
    const tabs: Tab[] = [
      { id: 'home', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' },
      { id: 'p', type: 'route', url: '/app/p', title: 'P', isPinned: true }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(2)
  })
  it('closes a normal tab on double click or middle click', () => {
    const handleDoubleClick = vi.fn()
    const handleAuxClick = vi.fn()
    const closeTab = renderTabBar(undefined, {
      onDoubleClick: handleDoubleClick,
      onAuxClick: handleAuxClick
    })
    const tabA = screen.getByRole('button', { name: 'A' })

    const doubleClick = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true
    })
    fireEvent(tabA, doubleClick)
    expect(closeTab).toHaveBeenCalledWith('a')
    expect(doubleClick.defaultPrevented).toBe(true)
    expect(handleDoubleClick).not.toHaveBeenCalled()

    closeTab.mockClear()
    const middleClick = new MouseEvent('auxclick', {
      button: 1,
      bubbles: true,
      cancelable: true
    })
    fireEvent(tabA, middleClick)
    expect(closeTab).toHaveBeenCalledWith('a')
    expect(middleClick.defaultPrevented).toBe(true)
    expect(handleAuxClick).not.toHaveBeenCalled()
  })

  it('closes a single normal tab on double click or middle click', () => {
    const handleDoubleClick = vi.fn()
    const handleAuxClick = vi.fn()
    const closeTab = renderTabBar(
      {
        tabs: [{ id: 'a', type: 'route', url: '/app/a', title: 'A' }],
        activeTabId: 'a'
      },
      {
        onDoubleClick: handleDoubleClick,
        onAuxClick: handleAuxClick
      }
    )
    const tabA = screen.getByRole('button', { name: 'A' })

    const doubleClick = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true
    })
    fireEvent(tabA, doubleClick)

    const middleClick = new MouseEvent('auxclick', {
      button: 1,
      bubbles: true,
      cancelable: true
    })
    fireEvent(tabA, middleClick)

    expect(closeTab).toHaveBeenCalledWith('a')
    expect(closeTab).toHaveBeenCalledTimes(2)
    expect(doubleClick.defaultPrevented).toBe(true)
    expect(middleClick.defaultPrevented).toBe(true)
    expect(handleDoubleClick).not.toHaveBeenCalled()
    expect(handleAuxClick).not.toHaveBeenCalled()
  })
})

describe('getTabCapabilities', () => {
  const ctx = (over?: Partial<{ pinnedCount: number; normalCount: number; canDetach: boolean }>) => ({
    pinnedCount: 1,
    normalCount: 1,
    canDetach: true,
    ...over
  })

  it('keeps close, pin, detach, and menu enabled for the last normal tab', () => {
    expect(getTabCapabilities({ id: 'home', isPinned: false }, ctx({ normalCount: 1 }))).toEqual({
      menu: true,
      reorder: false,
      togglePin: true,
      detach: true,
      close: true
    })
  })

  it('unlocks every normal action once a second normal tab exists', () => {
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 2 }))).toEqual({
      menu: true,
      reorder: true,
      togglePin: true,
      detach: true,
      close: true
    })
  })

  it('does not treat newly-created chat tabs as the fixed home tab', () => {
    expect(getTabCapabilities({ id: 'chat', isPinned: false }, ctx({ normalCount: 2 }))).toEqual({
      menu: true,
      reorder: true,
      togglePin: true,
      detach: true,
      close: true
    })
  })

  it('treats the home tab like any other normal tab when siblings exist', () => {
    expect(getTabCapabilities({ id: 'home', isPinned: false }, ctx({ normalCount: 3 }))).toEqual({
      menu: true,
      reorder: true,
      togglePin: true,
      detach: true,
      close: true
    })
  })

  it('lets pinned tabs unpin but never close, reordering only with siblings', () => {
    expect(getTabCapabilities({ id: 'p', isPinned: true }, ctx({ pinnedCount: 1 }))).toEqual({
      menu: true,
      reorder: false,
      togglePin: true,
      detach: true,
      close: false
    })
    expect(getTabCapabilities({ id: 'p', isPinned: true }, ctx({ pinnedCount: 2 })).reorder).toBe(true)
  })

  it('respects window detach support', () => {
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 2 })).detach).toBe(true)
    expect(getTabCapabilities({ id: 'p', isPinned: true }, ctx({ pinnedCount: 2 })).detach).toBe(true)
    expect(getTabCapabilities({ id: 'a', isPinned: false }, ctx({ normalCount: 2, canDetach: false })).detach).toBe(
      false
    )
  })
})
