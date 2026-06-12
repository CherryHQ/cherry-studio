// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuItemContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
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
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  uuid: () => 'new-tab-id'
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (route: string) => route
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../ShellTabBarActions', () => ({
  ShellTabBarActions: () => null,
  useShellTabBarLayout: () => ({ rightPaddingClass: '' })
}))

import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { AppShellTabBar } from '../AppShellTabBar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AppShellTabBar', () => {
  const renderTabBar = (props?: Partial<ComponentProps<typeof AppShellTabBar>>) => {
    const closeTab = vi.fn()
    const tabs: Tab[] = [
      { id: 'home', type: 'route', url: '/home', title: 'Home' },
      { id: 'a', type: 'route', url: '/app/a', title: 'A' }
    ]

    render(
      <AppShellTabBar
        tabs={tabs}
        activeTabId="home"
        setActiveTab={vi.fn()}
        closeTab={closeTab}
        addTab={vi.fn()}
        reorderTabs={vi.fn()}
        pinTab={vi.fn()}
        unpinTab={vi.fn()}
        {...props}
      />
    )

    return closeTab
  }

  it('closes a normal tab on double click or middle click', () => {
    const closeTab = renderTabBar()
    const tabA = screen.getByRole('button', { name: 'A' })

    fireEvent.doubleClick(tabA)
    expect(closeTab).toHaveBeenCalledWith('a')

    closeTab.mockClear()
    fireEvent(
      tabA,
      new MouseEvent('auxclick', {
        button: 1,
        bubbles: true,
        cancelable: true
      })
    )
    expect(closeTab).toHaveBeenCalledWith('a')
  })

  it('keeps tabs open on double click or middle click when close controls are hidden', () => {
    const closeTab = renderTabBar({ isDetached: true })
    const tabA = screen.getByRole('button', { name: 'A' })

    fireEvent.doubleClick(tabA)
    fireEvent(
      tabA,
      new MouseEvent('auxclick', {
        button: 1,
        bubbles: true,
        cancelable: true
      })
    )

    expect(closeTab).not.toHaveBeenCalled()
  })
})
