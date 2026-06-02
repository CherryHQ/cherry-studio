// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ShellTabBarActionsModule from '../ShellTabBarActions'

const mocks = vi.hoisted(() => ({
  emitResourceListReveal: vi.fn(),
  showSearchPopup: vi.fn()
}))

vi.mock('@renderer/components/Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('@renderer/components/chat/resources/resourceListRevealEvents', () => ({
  emitResourceListReveal: mocks.emitResourceListReveal
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
    t: (key: string) => (key === 'globalSearch.open' ? 'Open global search' : key)
  })
}))

// Render the command context menu's extra items inline as buttons so each tab's
// "move to first" action is directly clickable without driving the real menu.
vi.mock('@renderer/commands', () => ({
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
  it('opens global search from the plus button instead of adding a launchpad tab', async () => {
    const user = userEvent.setup()
    const addTab = vi.fn()
    const tabs: Tab[] = [
      {
        id: 'chat',
        type: 'route',
        url: '/app/chat',
        title: 'Chat'
      }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="chat"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        addTab={addTab}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Open global search' }))

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
    expect(addTab).not.toHaveBeenCalled()
  })

  it('moves a normal tab to the very first slot, ahead of the default chat tab', async () => {
    const user = userEvent.setup()
    const reorderTabs = vi.fn()
    // The bar's normal list mirrors the TabsContext order; no tab is special, so
    // "move to first" can take any tab all the way to index 0.
    const tabs: Tab[] = [
      { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' },
      { id: 'b', type: 'route', url: '/app/b', title: 'B' }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="chat"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={reorderTabs}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
      />
    )

    // Every tab exposes the menu (chat, a, b); click b's, which is last.
    const moveButtons = screen.getAllByTestId('menu-tab.move-to-first')
    expect(moveButtons).toHaveLength(3)
    await user.click(moveButtons[2])

    // Normal list is [chat, a, b]: b is at index 2 and moves to index 0.
    expect(reorderTabs).toHaveBeenCalledWith('normal', 2, 0)
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
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(setActiveTab).toHaveBeenCalledWith('chat')
    expect(setActiveTab).toHaveBeenCalledWith('agents')
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'assistants', tabId: 'chat' })
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'agents' })
  })

  it('disables the tab context menu when only a single tab is open', () => {
    const tabs: Tab[] = [{ id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="chat"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
      />
    )

    expect(screen.queryByTestId('menu-tab.move-to-first')).toBeNull()
  })

  it('gives the last normal tab no menu and forbids closing pinned tabs', () => {
    // One normal (chat) + one pinned tab: chat is the last normal tab so it
    // can't be closed/pinned/detached → no menu at all; the pinned tab keeps an
    // unpin action but never a close.
    const tabs: Tab[] = [
      { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'p', type: 'route', url: '/app/p', title: 'P', isPinned: true }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="chat"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
      />
    )

    // Only the pinned tab exposes a menu, and that menu is unpin-only.
    expect(screen.queryAllByTestId('menu-tab.pin')).toHaveLength(1)
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(0)
    expect(screen.queryAllByTestId('menu-tab.move-to-first')).toHaveLength(0)
  })

  it('allows closing normal tabs while more than one normal tab is open', () => {
    const tabs: Tab[] = [
      { id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' },
      { id: 'p', type: 'route', url: '/app/p', title: 'P', isPinned: true }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="chat"
        setActiveTab={vi.fn()}
        closeTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
      />
    )

    // The two normal tabs (chat, a) are closeable; the pinned tab is not.
    expect(screen.queryAllByTestId('menu-tab.close')).toHaveLength(2)
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
    expect(getTabCapabilities({ isPinned: false }, ctx({ normalCount: 1 }))).toEqual({
      menu: false,
      reorder: false,
      togglePin: false,
      detach: false,
      close: false
    })
  })

  it('unlocks every normal action once a second normal tab exists', () => {
    expect(getTabCapabilities({ isPinned: false }, ctx({ normalCount: 2 }))).toEqual({
      menu: true,
      reorder: true,
      togglePin: true,
      detach: true,
      close: true
    })
  })

  it('lets pinned tabs unpin but never close, reordering only with siblings', () => {
    expect(getTabCapabilities({ isPinned: true }, ctx({ pinnedCount: 1 }))).toEqual({
      menu: true,
      reorder: false,
      togglePin: true,
      detach: true,
      close: false
    })
    expect(getTabCapabilities({ isPinned: true }, ctx({ pinnedCount: 2 })).reorder).toBe(true)
  })

  it('never detaches temporary tabs or when the window cannot detach', () => {
    expect(getTabCapabilities({ isPinned: false, isTemporary: true }, ctx({ normalCount: 2 })).detach).toBe(false)
    expect(getTabCapabilities({ isPinned: true, isTemporary: true }, ctx({ pinnedCount: 2 })).detach).toBe(false)
    expect(getTabCapabilities({ isPinned: false }, ctx({ normalCount: 2, canDetach: false })).detach).toBe(false)
  })
})
