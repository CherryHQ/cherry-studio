import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTabsContext } from '@renderer/hooks/tab'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { TabsProvider } from '../TabsProvider'

vi.mock('@renderer/components/AgentBrowserRuntimeHost', () => ({ AgentBrowserRuntimeHost: () => null }))

const browserTab: Tab = {
  id: 'browser',
  type: 'route',
  url: '/app/browser?url=https%3A%2F%2Fexample.com',
  title: 'Example'
}
const normalTabs: Tab[] = ['first', 'middle', 'last'].map((id) => ({
  id,
  type: 'route',
  url: `/app/chat?topicId=${id}`,
  title: id
}))

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  MockUseCacheUtils.setPersistCacheValue('ui.tab.normal_tabs', normalTabs)
  MockUseCacheUtils.setPersistCacheValue('ui.tab.active_tab_id', 'middle')
})
afterEach(cleanup)

function renderTabs() {
  return renderHook(useTabsContext, { wrapper: ({ children }) => <TabsProvider>{children}</TabsProvider> })
}

describe('tab placement', () => {
  it('appends to the end when explicitly requested from a middle tab', () => {
    const { result } = renderTabs()
    act(() => {
      result.current.openTab('/app/launchpad', { id: 'launchpad', position: 'end' })
    })

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['first', 'middle', 'last', 'launchpad'])
    expect(result.current.activeTabId).toBe('launchpad')
  })

  it.each(['openTab', 'attachTab'] as const)('inserts %s to the right of the active tab', (entry) => {
    const { result } = renderTabs()

    act(() => {
      if (entry === 'openTab') result.current.openTab(browserTab.url, { id: browserTab.id })
      else result.current.attachTab(browserTab)
    })

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['first', 'middle', 'browser', 'last'])
    expect(result.current.activeTabId).toBe('browser')
  })

  it('appends after the last tab when it is active', () => {
    const { result } = renderTabs()
    act(() => result.current.setActiveTab('last'))
    act(() => result.current.attachTab(browserTab))

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['first', 'middle', 'last', 'browser'])
  })

  it('inserts at the start of normal tabs when a pinned tab is active', () => {
    MockUseCacheUtils.setPersistCacheValue(
      'ui.tab.pinned_tabs',
      ['pin-1', 'pin-2'].map((id) => ({ ...normalTabs[0], id, isPinned: true }))
    )
    MockUseCacheUtils.setPersistCacheValue('ui.tab.active_tab_id', 'pin-1')
    const { result } = renderTabs()
    act(() => result.current.attachTab(browserTab))

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['pin-1', 'pin-2', 'browser', 'first', 'middle', 'last'])
    expect(result.current.tabs.find((tab) => tab.id === 'browser')?.isPinned).toBeFalsy()
  })

  it('activates an existing browser tab without moving or duplicating it', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.tab.normal_tabs', [...normalTabs, browserTab])
    const { result } = renderTabs()
    act(() => {
      result.current.openTab(browserTab.url)
    })

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['first', 'middle', 'last', 'browser'])
    expect(result.current.activeTabId).toBe('browser')
  })

  it('uses the latest active tab when multiple links open before a render', () => {
    const { result } = renderTabs()
    act(() => {
      result.current.attachTab(browserTab)
      result.current.attachTab({ ...browserTab, id: 'second-browser', url: '/app/browser?url=https://second.test' })
    })

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['first', 'middle', 'browser', 'second-browser', 'last'])
    expect(result.current.activeTabId).toBe('second-browser')
  })

  it('uses the same insertion rule for non-browser tabs', () => {
    const { result } = renderTabs()
    act(() => {
      result.current.openTab('/app/files', { id: 'files' })
    })

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['first', 'middle', 'files', 'last'])
  })
})
