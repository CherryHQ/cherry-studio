import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConversationNavigation } from '../useConversationNavigation'

// Drive the boundary over a fake tabs context; config/sidebar (the identity↔url registry)
// runs for real, so these tests also lock the assistants/agents instanceKey wiring.
const tabsMock = vi.hoisted(() => ({
  ctx: null as ReturnType<typeof makeCtx> | null,
  emitResourceListReveal: vi.fn()
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: () => tabsMock.ctx
}))

vi.mock('@renderer/components/chat/resources/resourceListRevealEvents', () => ({
  emitResourceListReveal: tabsMock.emitResourceListReveal
}))

function makeCtx(tabs: Array<{ id: string; type: string; url: string; metadata?: Record<string, unknown> }>) {
  return { tabs, openTab: vi.fn(), setActiveTab: vi.fn() }
}

beforeEach(() => {
  tabsMock.ctx = null
  tabsMock.emitResourceListReveal.mockClear()
})

describe('useConversationNavigation', () => {
  it('focuses an existing tab matching the key', () => {
    const ctx = makeCtx([{ id: 'tab-1', type: 'route', url: '/app/chat?topicId=t1' }])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(result.current.focusExistingTab('t1')).toBe(true)
    expect(ctx.setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(tabsMock.emitResourceListReveal).toHaveBeenCalledWith({ source: 'assistants', tabId: 'tab-1' })
  })

  it('returns false without focusing when no tab matches', () => {
    const ctx = makeCtx([])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(result.current.focusExistingTab('t1')).toBe(false)
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
  })

  it('excludes the current tab when deduping', () => {
    const ctx = makeCtx([{ id: 'self', type: 'route', url: '/app/chat?topicId=t1' }])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(result.current.focusExistingTab('t1', { excludeTabId: 'self' })).toBe(false)
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
  })

  it('matches the current conversation key from tab metadata before the entry URL', () => {
    const ctx = makeCtx([
      {
        id: 'tab-1',
        type: 'route',
        url: '/app/chat?topicId=entry-topic',
        metadata: { instanceAppId: 'assistants', instanceKey: 'current-topic' }
      }
    ])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(result.current.focusExistingTab('current-topic')).toBe(true)
    expect(ctx.setActiveTab).toHaveBeenCalledWith('tab-1')
  })

  it('openConversationTab opens a forceNew base-route tab with metadata when none exists', () => {
    const ctx = makeCtx([])
    ctx.openTab.mockReturnValue('new-agent-tab')
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openConversationTab('s1', 'Session 1')
    expect(ctx.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Session 1',
      metadata: { instanceAppId: 'agents', instanceKey: 's1' }
    })
    expect(tabsMock.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'new-agent-tab' })
  })

  it('openConversationTab focuses an existing tab instead of duplicating', () => {
    const ctx = makeCtx([{ id: 'tab-x', type: 'route', url: '/app/agents?sessionId=s1' }])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openConversationTab('s1')
    expect(ctx.setActiveTab).toHaveBeenCalledWith('tab-x')
    expect(tabsMock.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'tab-x' })
    expect(ctx.openTab).not.toHaveBeenCalled()
  })

  it('openConversationTab can force opening a duplicate tab even when one exists', () => {
    const ctx = makeCtx([{ id: 'tab-x', type: 'route', url: '/app/agents?sessionId=s1' }])
    ctx.openTab.mockReturnValue('duplicate-agent-tab')
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openConversationTab('s1', 'Session 1', { forceNew: true })
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
    expect(ctx.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Session 1',
      metadata: { instanceAppId: 'agents', instanceKey: 's1' }
    })
    expect(tabsMock.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'duplicate-agent-tab' })
  })

  it('openConversationTab opens a forceNew tab after metadata-aware lookup misses', () => {
    const ctx = makeCtx([])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    result.current.openConversationTab('t1', 'Topic 1')
    expect(ctx.openTab).toHaveBeenCalledWith('/app/chat', {
      forceNew: true,
      title: 'Topic 1',
      metadata: { instanceAppId: 'assistants', instanceKey: 't1' }
    })
  })

  it('openConversationTab does not url-dedupe into a stale tab whose metadata points elsewhere', () => {
    const ctx = makeCtx([
      {
        id: 'stale-url',
        type: 'route',
        url: '/app/chat?topicId=t1',
        metadata: { instanceAppId: 'assistants', instanceKey: 't2' }
      }
    ])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    result.current.openConversationTab('t1', 'Topic 1')
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
    expect(ctx.openTab).toHaveBeenCalledWith('/app/chat', {
      forceNew: true,
      title: 'Topic 1',
      metadata: { instanceAppId: 'assistants', instanceKey: 't1' }
    })
  })

  it('focusExistingTab ignores stale URL fallback when metadata marks the app instance as cleared', () => {
    const ctx = makeCtx([
      {
        id: 'temp-tab',
        type: 'route',
        url: '/app/chat?topicId=t1',
        metadata: { instanceAppId: 'assistants' }
      }
    ])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(result.current.focusExistingTab('t1')).toBe(false)
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
  })

  it('focusExistingTab ignores message-only route URLs for normal conversation matching', () => {
    const ctx = makeCtx([{ id: 'message-tab', type: 'route', url: '/app/agents?sessionId=s1&view=message' }])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('agents'))

    expect(result.current.focusExistingTab('s1')).toBe(false)
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
  })

  it('no-ops without a tabs provider', () => {
    tabsMock.ctx = null
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(result.current.focusExistingTab('t1')).toBe(false)
    expect(() => result.current.openConversationTab('t1')).not.toThrow()
  })

  it('openConversationWindow detaches a fresh window for the conversation key without touching tabs', () => {
    const send = vi.fn()
    ;(window as unknown as { electron: { ipcRenderer: { send: typeof send } } }).electron = {
      ipcRenderer: { send }
    }
    const ctx = makeCtx([{ id: 'tab-1', type: 'route', url: '/app/chat?topicId=t1' }])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    result.current.openConversationWindow('t1', 'Topic 1')

    expect(send).toHaveBeenCalledTimes(1)
    const [channel, payload] = send.mock.calls[0] as [string, Record<string, unknown>]
    expect(channel).toBe('tab:detach')
    expect(payload).toMatchObject({
      url: '/app/chat?topicId=t1',
      title: 'Topic 1',
      type: 'route',
      metadata: { instanceAppId: 'assistants', instanceKey: 't1' }
    })
    expect(typeof payload.id).toBe('string')
    // Opening elsewhere must not focus or duplicate a tab in the current window.
    expect(ctx.openTab).not.toHaveBeenCalled()
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
  })
})
