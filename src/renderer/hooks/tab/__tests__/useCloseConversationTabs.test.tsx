// @vitest-environment jsdom
import type { TabsContextValue } from '@renderer/hooks/tab'
import { TabsContext } from '@renderer/hooks/tab/useTabsContext'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCloseConversationTabs } from '../useCloseConversationTabs'

function createTabsContext(tabs: Tab[], closeTabs = vi.fn(), activeTabId = tabs[0]?.id ?? ''): TabsContextValue {
  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  return {
    tabs,
    activeTabId,
    activeTab,
    isLoading: false,
    addTab: vi.fn(),
    closeTab: vi.fn(),
    closeTabs,
    setActiveTab: vi.fn(),
    updateTab: vi.fn(),
    openTab: vi.fn(),
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    reorderTabs: vi.fn(),
    detachTab: vi.fn(),
    attachTab: vi.fn()
  }
}

function wrapperFor(value: TabsContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <TabsContext value={value}>{children}</TabsContext>
  }
}

const activeConversationCases = [
  ['conversation', 'assistants', 'topic-a', '/app/chat', 'topicId'],
  ['agent session', 'agents', 'session-a', '/app/agents', 'sessionId']
] as const

describe('useCloseConversationTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes assistant tabs matching deleted topic ids', () => {
    const closeTabs = vi.fn()
    const context = createTabsContext(
      [
        {
          id: 'topic-a-tab',
          type: 'route',
          url: '/app/chat?topicId=topic-a',
          title: 'Topic A'
        },
        {
          id: 'topic-b-url-tab',
          type: 'route',
          url: '/app/chat?topicId=topic-b',
          title: 'Topic B'
        },
        {
          id: 'message-only-tab',
          type: 'route',
          url: '/app/chat?view=message&topicId=topic-a',
          title: 'Message'
        },
        {
          id: 'session-tab',
          type: 'route',
          url: '/app/agents?sessionId=topic-a',
          title: 'Session'
        }
      ],
      closeTabs,
      'session-tab'
    )

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current('assistants', ['topic-a', 'topic-b'])
    })

    expect(closeTabs).toHaveBeenCalledWith(['topic-a-tab', 'topic-b-url-tab'])
  })

  it('closes agent tabs matching deleted session ids', () => {
    const closeTabs = vi.fn()
    const context = createTabsContext(
      [
        {
          id: 'session-a-tab',
          type: 'route',
          url: '/app/agents?sessionId=session-a',
          title: 'Session A'
        },
        {
          id: 'session-b-url-tab',
          type: 'route',
          url: '/app/agents?sessionId=session-b',
          title: 'Session B'
        },
        {
          id: 'topic-tab',
          type: 'route',
          url: '/app/chat?topicId=session-a',
          title: 'Topic'
        }
      ],
      closeTabs,
      'topic-tab'
    )

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current('agents', ['session-a', 'session-b'])
    })

    expect(closeTabs).toHaveBeenCalledWith(['session-a-tab', 'session-b-url-tab'])
  })

  it.each(activeConversationCases)('keeps the active matching %s tab open', (_label, appId, key, baseUrl, queryKey) => {
    const activeTab: Tab = {
      id: `active-${key}-tab`,
      type: 'route',
      url: `${baseUrl}?${queryKey}=${key}`,
      title: 'Active'
    }
    const backgroundTab: Tab = {
      id: `background-${key}-tab`,
      type: 'route',
      url: `${baseUrl}?${queryKey}=${key}`,
      title: 'Background'
    }
    const closeTabs = vi.fn()
    const context = createTabsContext([activeTab, backgroundTab], closeTabs, activeTab.id)

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current(appId, [key])
    })

    expect(closeTabs).toHaveBeenCalledWith([backgroundTab.id])
  })

  it('delegates an empty close list when only the active tab matches', () => {
    const closeTabs = vi.fn()
    const context = createTabsContext(
      [
        {
          id: 'active-topic-tab',
          type: 'route',
          url: '/app/chat?topicId=topic-a',
          title: 'Active Topic'
        }
      ],
      closeTabs,
      'active-topic-tab'
    )

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current('assistants', ['topic-a'])
    })

    expect(closeTabs).toHaveBeenCalledWith([])
  })
})
