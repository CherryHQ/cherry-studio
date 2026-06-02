import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Controllable init data + tab API. `init` is read live by the useWindowInitData mock so we
// can flip it between renders to simulate cold start and pool reuse.
const mocks = vi.hoisted(() => ({
  init: null as null | Record<string, unknown>,
  tab: {
    resetNormalTabs: vi.fn(),
    setActiveTab: vi.fn(),
    closeTab: vi.fn(),
    updateTab: vi.fn(),
    addTab: vi.fn(),
    reorderTabs: vi.fn(),
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    tabs: [] as Array<{ id: string; type: string; url: string; isDormant?: boolean }>,
    activeTabId: 'home'
  }
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => mocks.init
}))
vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => mocks.tab
}))
vi.mock('@renderer/components/layout/AppShellTabBar', () => ({ AppShellTabBar: () => null }))
vi.mock('@renderer/components/layout/TabRouter', () => ({ TabRouter: () => null }))
vi.mock('@renderer/components/MiniApp/MiniAppTabsPool', () => ({ default: () => null }))

import { SubWindowAppShell } from '../SubWindowAppShell'

describe('SubWindowAppShell init/reuse', () => {
  beforeEach(() => {
    mocks.init = null
    mocks.tab.resetNormalTabs.mockClear()
    mocks.tab.setActiveTab.mockClear()
    mocks.tab.tabs = []
    mocks.tab.activeTabId = 'home'
    document.body.innerHTML = '<div id="spinner"></div>'
  })

  it('does nothing and keeps the spinner until init data arrives', () => {
    render(<SubWindowAppShell />)
    expect(mocks.tab.resetNormalTabs).not.toHaveBeenCalled()
    expect(document.getElementById('spinner')).not.toBeNull()
  })

  it('resets to the detached route tab and removes the spinner on cold start', () => {
    mocks.init = { tabId: 't1', url: '/chat', title: 'Chat', type: 'route', isPinned: false }
    render(<SubWindowAppShell />)

    expect(mocks.tab.resetNormalTabs).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', url: '/chat', title: 'Chat', type: 'route' })
    )
    expect(document.getElementById('spinner')).toBeNull()
  })

  it('re-initializes by replacing (not appending) when init changes on pool reuse', () => {
    mocks.init = { tabId: 't1', url: '/chat', type: 'route', isPinned: false }
    const { rerender } = render(<SubWindowAppShell />)
    expect(mocks.tab.resetNormalTabs).toHaveBeenCalledTimes(1)

    mocks.init = { tabId: 't2', url: '/settings', type: 'route', isPinned: false }
    rerender(<SubWindowAppShell />)

    expect(mocks.tab.resetNormalTabs).toHaveBeenCalledTimes(2)
    expect(mocks.tab.resetNormalTabs).toHaveBeenLastCalledWith(expect.objectContaining({ id: 't2', url: '/settings' }))
  })

  it('for a pinned detach, clears normal tabs and activates the pinned tab', () => {
    mocks.init = { tabId: 'p1', url: '/x', isPinned: true }
    render(<SubWindowAppShell />)

    expect(mocks.tab.resetNormalTabs).toHaveBeenCalledWith()
    expect(mocks.tab.setActiveTab).toHaveBeenCalledWith('p1')
  })
})
