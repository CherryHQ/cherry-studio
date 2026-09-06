// @vitest-environment jsdom
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  CloseConversationTabsContext,
  findClosableConversationTabIds,
  useCloseConversationTabs
} from '../useCloseConversationTabs'

const activeConversationCases = [
  ['conversation', 'assistants', 'topic-a', '/app/chat', 'topicId'],
  ['agent session', 'agents', 'session-a', '/app/agents', 'sessionId']
] as const

describe('findClosableConversationTabIds', () => {
  it('matches assistant tabs by topic id without crossing app routes', () => {
    const tabs: Tab[] = [
      { id: 'topic-a-tab', type: 'route', url: '/app/chat?topicId=topic-a', title: 'Topic A' },
      { id: 'topic-b-tab', type: 'route', url: '/app/chat?topicId=topic-b', title: 'Topic B' },
      { id: 'session', type: 'route', url: '/app/agents?sessionId=topic-a', title: 'Session' }
    ]

    expect(findClosableConversationTabIds(tabs, 'session', 'assistants', ['topic-a', 'topic-b'])).toEqual([
      'topic-a-tab',
      'topic-b-tab'
    ])
  })

  it('matches agent tabs by session id without crossing app routes', () => {
    const tabs: Tab[] = [
      { id: 'session-a-tab', type: 'route', url: '/app/agents?sessionId=session-a', title: 'Session A' },
      { id: 'session-b-tab', type: 'route', url: '/app/agents?sessionId=session-b', title: 'Session B' },
      { id: 'topic', type: 'route', url: '/app/chat?topicId=session-a', title: 'Topic' }
    ]

    expect(findClosableConversationTabIds(tabs, 'topic', 'agents', ['session-a', 'session-b'])).toEqual([
      'session-a-tab',
      'session-b-tab'
    ])
  })

  it('matches a tab restored with the legacy message-only view param by its conversation key', () => {
    const tabs: Tab[] = [
      { id: 'legacy', type: 'route', url: '/app/chat?topicId=topic-a&view=message', title: 'Topic A' },
      { id: 'active', type: 'route', url: '/app/chat?topicId=topic-b', title: 'Topic B' }
    ]

    expect(findClosableConversationTabIds(tabs, 'active', 'assistants', ['topic-a'])).toEqual(['legacy'])
  })

  it.each(activeConversationCases)('keeps the active matching %s tab open', (_label, appId, key, baseUrl, queryKey) => {
    const tabs: Tab[] = [
      { id: 'active', type: 'route', url: `${baseUrl}?${queryKey}=${key}`, title: 'Active' },
      { id: 'background', type: 'route', url: `${baseUrl}?${queryKey}=${key}`, title: 'Background' }
    ]

    expect(findClosableConversationTabIds(tabs, 'active', appId, [key])).toEqual(['background'])
  })

  it('returns an empty list when only the active tab matches', () => {
    const tabs: Tab[] = [{ id: 'active', type: 'route', url: '/app/chat?topicId=topic-a', title: 'Active Topic' }]

    expect(findClosableConversationTabIds(tabs, 'active', 'assistants', ['topic-a'])).toEqual([])
  })
})

describe('useCloseConversationTabs', () => {
  it('returns the action supplied by its narrow context', () => {
    const closeConversationTabs = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CloseConversationTabsContext value={closeConversationTabs}>{children}</CloseConversationTabsContext>
    )
    const { result } = renderHook(() => useCloseConversationTabs(), { wrapper })

    act(() => result.current('assistants', ['topic-a']))

    expect(closeConversationTabs).toHaveBeenCalledWith('assistants', ['topic-a'])
  })

  it('is a stable no-op outside TabsProvider', () => {
    const { result, rerender } = renderHook(() => useCloseConversationTabs())
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
    expect(() => result.current('agents', ['session-a'])).not.toThrow()
  })
})
