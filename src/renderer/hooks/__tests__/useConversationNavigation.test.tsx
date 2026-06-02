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

function makeCtx(tabs: Array<{ id: string; type: string; url: string }>) {
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

  it('openInNewTab opens a forceNew tab when none exists', () => {
    const ctx = makeCtx([])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openInNewTab('s1', 'Session 1')
    expect(ctx.openTab).toHaveBeenCalledWith('/app/agents?sessionId=s1', { forceNew: true, title: 'Session 1' })
  })

  it('openInNewTab focuses an existing tab instead of duplicating', () => {
    const ctx = makeCtx([{ id: 'tab-x', type: 'route', url: '/app/agents?sessionId=s1' }])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openInNewTab('s1')
    expect(ctx.setActiveTab).toHaveBeenCalledWith('tab-x')
    expect(tabsMock.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'tab-x' })
    expect(ctx.openTab).not.toHaveBeenCalled()
  })

  it('focusOrOpen opens without forceNew (url dedupe)', () => {
    const ctx = makeCtx([])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    result.current.focusOrOpen('t1', 'Topic 1')
    expect(ctx.openTab).toHaveBeenCalledWith('/app/chat?topicId=t1', { title: 'Topic 1' })
  })

  it('no-ops without a tabs provider', () => {
    tabsMock.ctx = null
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(result.current.focusExistingTab('t1')).toBe(false)
    expect(() => result.current.openInNewTab('t1')).not.toThrow()
    expect(() => result.current.focusOrOpen('t1')).not.toThrow()
  })
})
