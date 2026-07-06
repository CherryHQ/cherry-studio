// @vitest-environment jsdom
import type { TabsContextValue } from '@renderer/hooks/tab'
import { TabsContext } from '@renderer/hooks/tab/useTabsContext'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCloseConversationTabs } from '../useCloseConversationTabs'

function createTabsContext(tabs: Tab[], closeTab = vi.fn()): TabsContextValue {
  return {
    tabs,
    activeTabId: tabs[0]?.id ?? '',
    activeTab: tabs[0],
    isLoading: false,
    addTab: vi.fn(),
    closeTab,
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

describe('useCloseConversationTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes assistant tabs matching deleted topic ids', () => {
    const closeTab = vi.fn()
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
      closeTab
    )

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current('assistants', ['topic-a', 'topic-b'])
    })

    expect(closeTab).toHaveBeenCalledWith('topic-a-tab')
    expect(closeTab).toHaveBeenCalledWith('topic-b-url-tab')
    expect(closeTab).not.toHaveBeenCalledWith('message-only-tab')
    expect(closeTab).not.toHaveBeenCalledWith('session-tab')
  })

  it('closes agent tabs matching deleted session ids', () => {
    const closeTab = vi.fn()
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
      closeTab
    )

    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper: wrapperFor(context) })

    act(() => {
      result.current('agents', ['session-a', 'session-b'])
    })

    expect(closeTab).toHaveBeenCalledWith('session-a-tab')
    expect(closeTab).toHaveBeenCalledWith('session-b-url-tab')
    expect(closeTab).not.toHaveBeenCalledWith('topic-tab')
  })
})
