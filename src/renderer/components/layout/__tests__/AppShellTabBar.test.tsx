// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ShellTabBarActionsModule from '../ShellTabBarActions'

const mocks = vi.hoisted(() => ({
  showSearchPopup: vi.fn()
}))

vi.mock('@renderer/components/Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useMacTransparentWindow', () => ({
  default: () => false
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: false,
  isLinux: false,
  isWin: false,
  platform: 'linux'
}))

vi.mock('@renderer/config/miniApps', () => ({
  getMiniAppsLogo: () => undefined
}))

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false]
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ settedTheme: 'light', toggleTheme: vi.fn() })
}))

vi.mock('@renderer/i18n/label', () => ({
  getThemeModeLabel: () => 'Light'
}))

vi.mock('@renderer/services/SettingsWindowService', () => ({
  openSettingsWindow: vi.fn()
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
})

describe('AppShellTabBar', () => {
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

    expect(openTab).toHaveBeenCalledWith('/app/launchpad', { title: 'Launchpad' })
  })

  it('moves a normal tab to the first movable slot after the fixed home tab', async () => {
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

    // Home is fixed and exposes no menu; click b's menu, which is last.
    const moveButtons = screen.getAllByTestId('menu-tab.move-to-first')
    expect(moveButtons).toHaveLength(2)
    await user.click(moveButtons[1])

    // Normal list is [home, a, b]: b is at index 2 and moves to index 1.
    expect(reorderTabs).toHaveBeenCalledWith('normal', 2, 1)
  })

  it('does not expose drag or menu affordances for the fixed home tab', () => {
    const reorderTabs = vi.fn()
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
        reorderTabs={reorderTabs}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        openTab={vi.fn()}
      />
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Chat' }), {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10
    })
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 80, clientY: 10 })
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 80, clientY: 10 })

    expect(reorderTabs).not.toHaveBeenCalled()
    expect(screen.queryAllByTestId('menu-tab.move-to-first')).toHaveLength(1)
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

  it('disables the tab context menu when only a single tab is open', () => {
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
  })

  it('gives the last normal tab no menu and forbids closing pinned tabs', () => {
    // One normal (home) + one pinned tab: home is the last normal tab so it
    // can't be closed/pinned/detached → no menu at all; the pinned tab keeps an
    // unpin action but never a close.
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

    // Only the pinned tab exposes a menu, and that menu is unpin-only.
    expect(screen.queryAllByTestId('menu-tab.pin')).toHaveLength(1)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(0)
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

    // Only the non-home normal tab is closeable; the fixed home tab and pinned tab are not.
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(1)
  })
})

describe('getTabCapabilities', () => {
  const ctx = (over?: Partial<{ pinnedCount: number; normalCount: number; canDetach: boolean }>) => ({
    pinnedCount: 1,
    normalCount: 1,
    canDetach: true,
    ...over
  })

  it('gives the last normal tab no actions at all', () => {
    expect(getTabCapabilities({ id: 'home', isPinned: false }, ctx({ normalCount: 1 }))).toEqual({
      menu: false,
      reorder: false,
      togglePin: false,
      detach: false,
      close: false
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

  it('keeps the home tab fixed with no tab actions', () => {
    expect(getTabCapabilities({ id: 'home', isPinned: false }, ctx({ normalCount: 3 }))).toEqual({
      menu: false,
      reorder: false,
      togglePin: false,
      detach: false,
      close: false
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
