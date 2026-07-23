import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConversationNavigation } from '../useConversationNavigation'

// Drive the boundary over a fake tabs context; utils/sidebar (the identity↔url registry)
// runs for real, so these tests also lock the assistants/agents instanceKey wiring.
const tabsMock = vi.hoisted(() => ({
  ctx: null as ReturnType<typeof makeCtx> | null,
  emitResourceListReveal: vi.fn(),
  windowFrameMode: 'embedded' as 'embedded' | 'window'
}))

vi.mock('@renderer/hooks/tab', () => ({
  useOptionalTabsContext: () => tabsMock.ctx
}))

vi.mock('@renderer/services/resourceListRevealEvents', () => ({
  emitResourceListReveal: tabsMock.emitResourceListReveal
}))

vi.mock('@renderer/hooks/useWindowFrame', () => ({
  useWindowFrame: () => ({ mode: tabsMock.windowFrameMode })
}))

// "Open elsewhere" detaches a window through the typed IpcApi facade.
const ipcMock = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcMock.request }, useIpcOn: vi.fn() }))

function makeCtx(tabs: Array<{ id: string; type: string; url: string; metadata?: Record<string, unknown> }>) {
  return { tabs, openTab: vi.fn(), setActiveTab: vi.fn() }
}

beforeEach(() => {
  tabsMock.ctx = null
  tabsMock.emitResourceListReveal.mockClear()
  tabsMock.windowFrameMode = 'embedded'
  ipcMock.request.mockClear()
})

describe('useConversationNavigation', () => {
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

  it('openConversationTab opens a new tab even when one exists', () => {
    const ctx = makeCtx([{ id: 'tab-x', type: 'route', url: '/app/agents?sessionId=s1' }])
    ctx.openTab.mockReturnValue('new-agent-tab')
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openConversationTab('s1', 'Session 1')
    expect(ctx.setActiveTab).not.toHaveBeenCalled()
    expect(ctx.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Session 1',
      metadata: { instanceAppId: 'agents', instanceKey: 's1' }
    })
    expect(tabsMock.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'new-agent-tab' })
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

  it('no-ops without a tabs provider', () => {
    tabsMock.ctx = null
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    expect(() => result.current.openConversationTab('t1')).not.toThrow()
  })

  it('openConversationWindow detaches a fresh window for the conversation key without touching tabs', () => {
    const ctx = makeCtx([{ id: 'tab-1', type: 'route', url: '/app/chat?topicId=t1' }])
    tabsMock.ctx = ctx
    const { result } = renderHook(() => useConversationNavigation('assistants'))

    result.current.openConversationWindow('t1', 'Topic 1')

    expect(ipcMock.request).toHaveBeenCalledTimes(1)
    const [channel, payload] = ipcMock.request.mock.calls[0] as [string, Record<string, unknown>]
    expect(channel).toBe('tab.detach')
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

  it('openConversation routes through current tabs when embedded and tabs are available', () => {
    const ctx = makeCtx([])
    ctx.openTab.mockReturnValue('new-agent-tab')
    tabsMock.ctx = ctx
    tabsMock.windowFrameMode = 'embedded'
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openConversation('s1', 'Session 1')

    expect(ctx.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Session 1',
      metadata: { instanceAppId: 'agents', instanceKey: 's1' }
    })
  })

  it('openConversation routes to a detached window when the host frame is detached', () => {
    tabsMock.ctx = makeCtx([])
    tabsMock.windowFrameMode = 'window'
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openConversation('s1', 'Session 1')

    expect(ipcMock.request).toHaveBeenCalledTimes(1)
    expect(ipcMock.request.mock.calls[0][1]).toMatchObject({
      url: '/app/agents?sessionId=s1',
      title: 'Session 1',
      type: 'route',
      metadata: { instanceAppId: 'agents', instanceKey: 's1' }
    })
  })

  it('openConversationTab does not create a hidden tab in a detached window', () => {
    const ctx = makeCtx([])
    tabsMock.ctx = ctx
    tabsMock.windowFrameMode = 'window'
    const { result } = renderHook(() => useConversationNavigation('agents'))

    expect(result.current.openConversationTab('s1', 'Session 1')).toBeUndefined()
    expect(ctx.openTab).not.toHaveBeenCalled()
    expect(tabsMock.emitResourceListReveal).not.toHaveBeenCalled()
  })

  it('openConversation routes to a detached window without a tabs provider', () => {
    tabsMock.ctx = null
    const { result } = renderHook(() => useConversationNavigation('agents'))

    result.current.openConversation('s1')

    expect(ipcMock.request).toHaveBeenCalledTimes(1)
    expect(ipcMock.request.mock.calls[0][1]).toMatchObject({ url: '/app/agents?sessionId=s1' })
  })
})
