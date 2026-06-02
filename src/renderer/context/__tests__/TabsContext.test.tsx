import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { TabsProvider, useTabsContext } from '../TabsContext'

const wrapper = ({ children }: { children: ReactNode }) => <TabsProvider>{children}</TabsProvider>

const makeTab = (id: string, url = `/x/${id}`): Tab => ({
  id,
  type: 'route',
  url,
  title: id,
  lastAccessTime: 0,
  isDormant: false
})

describe('TabsContext.resetNormalTabs', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('replaces the in-memory normal tabs with a single tab and activates it', () => {
    const { result } = renderHook(() => useTabsContext(), { wrapper })

    act(() => {
      result.current.addTab(makeTab('a'))
      result.current.addTab(makeTab('b'))
    })
    expect(result.current.tabs.map((t) => t.id)).toEqual(['home', 'a', 'b'])

    act(() => {
      result.current.resetNormalTabs(makeTab('c'))
    })

    expect(result.current.tabs.map((t) => t.id)).toEqual(['home', 'c'])
    expect(result.current.activeTabId).toBe('c')
  })

  it('clears to just the home tab when called with no argument', () => {
    const { result } = renderHook(() => useTabsContext(), { wrapper })

    act(() => {
      result.current.addTab(makeTab('a'))
    })
    act(() => {
      result.current.resetNormalTabs()
    })

    expect(result.current.tabs.map((t) => t.id)).toEqual(['home'])
    expect(result.current.activeTabId).toBe('home')
  })

  it('does not touch the shared persistent pinnedTabs cache', () => {
    const pinned: Tab[] = [{ ...makeTab('pinned-1'), isPinned: true }]
    MockUseCacheUtils.setPersistCacheValue('ui.tab.pinned_tabs', pinned)

    const { result } = renderHook(() => useTabsContext(), { wrapper })
    expect(result.current.tabs.map((t) => t.id)).toContain('pinned-1')

    act(() => {
      result.current.resetNormalTabs(makeTab('c'))
    })

    // Normal tabs reset; the pinned tab survives both in the merged list and in the persist store.
    expect(result.current.tabs.map((t) => t.id)).toEqual(['home', 'pinned-1', 'c'])
    expect(MockUseCacheUtils.getPersistCacheValue('ui.tab.pinned_tabs')).toEqual(pinned)
  })
})
