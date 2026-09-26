import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Tab } from '@shared/data/cache/cacheValueTypes'

const capture = vi.hoisted(() => ({
  current: null as {
    tabs: Tab[]
    activeTabId: string
    setActiveTab: (id: string) => void
    setTabs: (tabs: Tab[]) => void
  } | null
}))

const initialTabs: Tab[] = [
  { id: 'chat', type: 'route', url: '/app/chat?topicId=existing', title: 'Chat' },
  { id: 'agent', type: 'route', url: '/app/agents?sessionId=existing', title: 'Agent' },
  { id: 'other-agent', type: 'route', url: '/app/agents?sessionId=notification', title: 'Notification' },
  { id: 'note', type: 'route', url: '/app/notes/document', title: 'Note' }
]

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => {
    const [tabs, setTabs] = useState(initialTabs)
    const [activeTabId, setActiveTab] = useState('chat')
    capture.current = { tabs, activeTabId, setActiveTab, setTabs }
    return {
      tabs,
      activeTabId,
      setActiveTab,
      closeTabs: (ids: readonly string[], activateId?: string) => {
        setTabs((current) => current.filter((tab) => !ids.includes(tab.id)))
        if (ids.includes(activeTabId) && activateId) setActiveTab(activateId)
      },
      openTab: (url: string) => {
        const id = `new:${url}`
        setTabs((current) => [...current, { id, url, title: '', type: 'route' }])
        setActiveTab(id)
        return id
      }
    }
  }
}))

import { useMinimalNavigation } from '../useMinimalNavigation'

afterEach(() => {
  MockUsePreferenceUtils.resetMocks()
  MockUseCacheUtils.resetMocks()
})

describe('minimal navigation', () => {
  it('enters Agent home on activation and preserves the chosen feature across rerenders', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'efficiency')
    const { result, rerender } = renderHook(useMinimalNavigation)
    expect(result.current.enabled).toBe(false)
    expect(result.current.isHome).toBe(false)
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    rerender()
    expect(result.current.isHome).toBe(true)
    act(() => result.current.openFeature('/app/notes'))
    expect(result.current.isHome).toBe(false)
    expect(capture.current?.activeTabId).toBe('note')
    expect(capture.current?.tabs).toEqual(initialTabs)
    rerender()
    expect(result.current.isHome).toBe(false)
    act(() => result.current.returnHome())
    expect(result.current.isHome).toBe(true)
    expect(capture.current?.activeTabId).toBe('agent')
    expect(capture.current?.tabs).toEqual(initialTabs)
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'efficiency')
    rerender()
    expect(capture.current?.tabs).toEqual([initialTabs[1]])
    expect(capture.current?.activeTabId).toBe('agent')
  })

  it('does not redirect a subsequent explicit navigation back to home', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result, rerender } = renderHook(useMinimalNavigation)
    act(() => capture.current?.setActiveTab('note'))
    rerender()
    expect(result.current.isHome).toBe(false)
    expect(capture.current?.activeTabId).toBe('note')
  })

  it('opens Agent as home rather than replacing it with a new session', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result } = renderHook(useMinimalNavigation)
    act(() => result.current.openFeature('/app/translate'))
    expect(result.current.isHome).toBe(false)
    act(() => result.current.openFeature('/app/agents'))
    expect(result.current.isHome).toBe(true)
    expect(capture.current?.activeTabId).toBe('agent')
    expect(capture.current?.tabs.filter((tab) => tab.url.startsWith('/app/agents'))).toHaveLength(2)
  })

  it('keeps the original home when a notification activates another Agent tab', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result } = renderHook(useMinimalNavigation)
    expect(capture.current?.activeTabId).toBe('agent')
    act(() => capture.current?.setActiveTab('other-agent'))
    expect(result.current.isHome).toBe(false)
    act(() => result.current.returnHome())
    expect(capture.current?.activeTabId).toBe('agent')
    expect(result.current.isHome).toBe(true)
    expect(capture.current?.tabs).toEqual(initialTabs)
  })

  it('reuses another Agent tab if the original home has been removed', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result } = renderHook(useMinimalNavigation)
    act(() => {
      capture.current?.setTabs(initialTabs.filter((tab) => tab.id !== 'agent'))
      capture.current?.setActiveTab('note')
    })
    act(() => result.current.returnHome())
    expect(capture.current?.activeTabId).toBe('other-agent')
    expect(result.current.isHome).toBe(true)
    expect(capture.current?.tabs).toHaveLength(initialTabs.length - 1)
  })

  it('creates a home when no Agent tab remains and reuses it on subsequent returns', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result } = renderHook(useMinimalNavigation)
    act(() => {
      capture.current?.setTabs(initialTabs.filter((tab) => !tab.url.startsWith('/app/agents')))
      capture.current?.setActiveTab('note')
    })
    act(() => result.current.returnHome())
    expect(result.current.isHome).toBe(true)
    const homeId = capture.current?.activeTabId
    act(() => result.current.openFeature('/app/notes'))
    act(() => result.current.returnHome())
    expect(capture.current?.activeTabId).toBe(homeId)
    expect(capture.current?.tabs.filter((tab) => tab.url.startsWith('/app/agents'))).toHaveLength(1)
  })
  it('switches between existing home tabs and returns to the chosen home without losing either conversation', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result } = renderHook(useMinimalNavigation)
    act(() => {
      result.current.switchHome('assistant')
    })
    expect(result.current.homeKind).toBe('assistant')
    expect(result.current.isHome).toBe(true)
    expect(capture.current?.activeTabId).toBe('chat')
    act(() =>
      capture.current?.setTabs(
        initialTabs.map((tab) => (tab.id === 'chat' ? { ...tab, url: '/app/chat?topicId=selected' } : tab))
      )
    )
    act(() => {
      result.current.switchHome('agent')
    })
    expect(capture.current?.activeTabId).toBe('agent')
    act(() => {
      result.current.switchHome('assistant')
    })
    act(() => result.current.openFeature('/app/notes'))
    expect(result.current.isHome).toBe(false)
    act(() => result.current.returnHome())
    expect(capture.current?.activeTabId).toBe('chat')
    expect(result.current.isHome).toBe(true)
    expect(capture.current?.tabs.find((tab) => tab.id === 'chat')?.url).toBe('/app/chat?topicId=selected')
    expect(capture.current?.tabs.find((tab) => tab.id === 'agent')?.url).toBe('/app/agents?sessionId=existing')
    expect(capture.current?.tabs).toHaveLength(initialTabs.length)
  })

  it('creates the missing assistant home once and opens launcher chat entries as that home', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result } = renderHook(useMinimalNavigation)
    act(() => capture.current?.setTabs(initialTabs.filter((tab) => tab.id !== 'chat')))
    act(() => result.current.openFeature('/app/chat'))
    expect(result.current.homeKind).toBe('assistant')
    expect(result.current.isHome).toBe(true)
    const assistantHomeId = capture.current?.activeTabId
    act(() => {
      result.current.switchHome('agent')
    })
    act(() => {
      result.current.switchHome('assistant')
    })
    expect(capture.current?.activeTabId).toBe(assistantHomeId)
    expect(capture.current?.tabs.filter((tab) => tab.url.startsWith('/app/chat'))).toHaveLength(1)
  })
  it('keeps the Agent home on exiting from Chat, including closing pinned and mini-app tabs', () => {
    MockUseCacheUtils.setCacheValue('mini_app.split_open', true)
    MockUseCacheUtils.setCacheValue('mini_app.split_id', 'example')
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result, rerender } = renderHook(useMinimalNavigation)
    act(() =>
      capture.current?.setTabs([
        ...initialTabs,
        { id: 'pinned', type: 'route', url: '/app/files', title: 'Files', isPinned: true },
        { id: 'mini', type: 'route', url: '/app/mini-app/example', title: 'Mini app' }
      ])
    )
    act(() => {
      result.current.switchHome('assistant')
    })
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'efficiency')
    rerender()
    expect(capture.current?.tabs).toEqual([initialTabs[1]])
    expect(capture.current?.activeTabId).toBe('agent')
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_open')).toBe(false)
    expect(MockUseCacheUtils.getCacheValue('mini_app.split_id')).toBe('')
    act(() => result.current.openFeature('/app/notes'))
    rerender()
    expect(capture.current?.tabs).toHaveLength(2)
    expect(capture.current?.activeTabId).toBe('new:/app/notes')
  })

  it('creates an Agent home before closing other tabs if the old home was removed', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'minimal')
    const { result, rerender } = renderHook(useMinimalNavigation)
    act(() => {
      result.current.switchHome('assistant')
    })
    act(() => capture.current?.setTabs(initialTabs.filter((tab) => !tab.url.startsWith('/app/agents'))))
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'efficiency')
    rerender()
    expect(capture.current?.tabs).toEqual([{ id: 'new:/app/agents', url: '/app/agents', title: '', type: 'route' }])
    expect(capture.current?.activeTabId).toBe('new:/app/agents')
  })

  it('leaves restored tabs alone when starting in efficiency mode', () => {
    MockUsePreferenceUtils.setPreferenceValue('ui.mode', 'efficiency')
    renderHook(useMinimalNavigation)
    expect(capture.current?.tabs).toEqual(initialTabs)
    expect(capture.current?.activeTabId).toBe('chat')
  })
})
