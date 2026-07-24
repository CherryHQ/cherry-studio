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
    registerTabLeaveGuard: vi.fn(),
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
          url: '/app/chat',
          title: 'Topic A',
          metadata: { instanceAppId: 'assistants', instanceKey: 'topic-a' }
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
          url: '/app/agents',
          title: 'Session',
          metadata: { instanceAppId: 'agents', instanceKey: 'topic-a' }
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
          url: '/app/agents',
          title: 'Session A',
          metadata: { instanceAppId: 'agents', instanceKey: 'session-a' }
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
          url: '/app/chat',
          title: 'Topic',
          metadata: { instanceAppId: 'assistants', instanceKey: 'session-a' }
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

  it('keeps the active matching conversation tab open', () => {
    const closeTabs = vi.fn()
    const context = createTabsContext(
      [
        {
          id: 'active-topic-tab',
          type: 'route',
          url: '/app/chat',
          title: 'Active Topic',
          metadata: { instanceAppId: 'assistants', instanceKey: 'topic-a' }
        },
        {
          id: 'background-topic-tab',
          type: 'route',
          url: '/app/chat?topicId=topic-a',
          title: 'Background Topic'
        }
      ],
      closeTabs,
      'active-topic-tab'
    )

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current('assistants', ['topic-a'])
    })

    expect(closeTabs).toHaveBeenCalledWith(['background-topic-tab'])
  })

  it('delegates an empty close list when only the active tab matches', () => {
    const closeTabs = vi.fn()
    const context = createTabsContext(
      [
        {
          id: 'active-topic-tab',
          type: 'route',
          url: '/app/chat',
          title: 'Active Topic',
          metadata: { instanceAppId: 'assistants', instanceKey: 'topic-a' }
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

  it('keeps the active matching agent session tab open', () => {
    const closeTabs = vi.fn()
    const context = createTabsContext(
      [
        {
          id: 'active-session-tab',
          type: 'route',
          url: '/app/agents',
          title: 'Active Session',
          metadata: { instanceAppId: 'agents', instanceKey: 'session-a' }
        },
        {
          id: 'background-session-tab',
          type: 'route',
          url: '/app/agents?sessionId=session-a',
          title: 'Background Session'
        }
      ],
      closeTabs,
      'active-session-tab'
    )

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current('agents', ['session-a'])
    })

    expect(closeTabs).toHaveBeenCalledWith(['background-session-tab'])
  })
})
