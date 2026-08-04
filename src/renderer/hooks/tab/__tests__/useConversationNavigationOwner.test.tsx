import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConversationNavigationOwner } from '../useConversationNavigationOwner'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: any) => void>(),
  request: vi.fn(() => Promise.resolve())
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request },
  useIpcOn: (event: string, handler: (payload: any) => void) => mocks.handlers.set(event, handler)
}))

const target = { conversationType: 'agent' as const, conversationId: 'session-1' }

function emit(event: string, payload: unknown): void {
  const handler = mocks.handlers.get(event)
  if (!handler) throw new Error(`Missing ${event} handler`)
  act(() => handler(payload))
}

describe('useConversationNavigationOwner', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
  })

  it('answers ownership on demand from the latest tab state', () => {
    const owner = {
      tabs: [] as Tab[],
      openTab: vi.fn(),
      setActiveTab: vi.fn()
    }
    const rendered = renderHook(({ value }) => useConversationNavigationOwner(value), {
      initialProps: { value: owner }
    })

    expect(mocks.request).not.toHaveBeenCalled()
    const latest = {
      ...owner,
      tabs: [
        {
          id: 'agent-tab',
          type: 'route' as const,
          url: '/app/agents',
          title: 'Refactor project',
          metadata: { instanceAppId: 'agents', instanceKey: 'session-1' }
        }
      ]
    }
    rendered.rerender({ value: latest })

    emit('navigation.conversation_ownership_requested', { requestId: 'request-1', target })

    expect(mocks.request).toHaveBeenCalledWith('navigation.report_conversation_ownership', {
      requestId: 'request-1',
      ownsTarget: true
    })
  })

  it('activates an existing target and confirms ownership after the command', () => {
    const owner = {
      tabs: [
        {
          id: 'agent-tab',
          type: 'route' as const,
          url: '/app/agents?sessionId=session-1',
          title: 'Refactor project'
        }
      ],
      openTab: vi.fn(),
      setActiveTab: vi.fn()
    }
    renderHook(({ value }) => useConversationNavigationOwner(value), {
      initialProps: { value: owner }
    })

    emit('navigation.conversation_focus_or_open_requested', {
      requestId: 'request-1',
      target,
      title: 'Refactor project'
    })
    expect(owner.setActiveTab).toHaveBeenCalledWith('agent-tab')
    expect(owner.openTab).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledWith('navigation.report_conversation_ownership', {
      requestId: 'request-1',
      ownsTarget: true
    })
  })

  it('confirms a missing target only after the new tab is committed', async () => {
    const owner = {
      tabs: [] as Tab[],
      openTab: vi.fn(),
      setActiveTab: vi.fn()
    }
    const rendered = renderHook(({ value }) => useConversationNavigationOwner(value), {
      initialProps: { value: owner }
    })

    emit('navigation.conversation_focus_or_open_requested', {
      requestId: 'request-2',
      target,
      title: 'Refactor project'
    })
    expect(owner.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Refactor project',
      metadata: { instanceAppId: 'agents', instanceKey: 'session-1' }
    })
    expect(mocks.request).not.toHaveBeenCalledWith('navigation.report_conversation_ownership', {
      requestId: 'request-2',
      ownsTarget: true
    })

    rendered.rerender({
      value: {
        ...owner,
        tabs: [
          {
            id: 'new-agent-tab',
            type: 'route',
            url: '/app/agents',
            title: 'Refactor project',
            metadata: { instanceAppId: 'agents', instanceKey: 'session-1' }
          }
        ]
      }
    })

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('navigation.report_conversation_ownership', {
        requestId: 'request-2',
        ownsTarget: true
      })
    )
  })

  it('coalesces repeated open commands for the same target until the tab is committed', async () => {
    const owner = {
      tabs: [] as Tab[],
      openTab: vi.fn(),
      setActiveTab: vi.fn()
    }
    const rendered = renderHook(({ value }) => useConversationNavigationOwner(value), {
      initialProps: { value: owner }
    })

    emit('navigation.conversation_focus_or_open_requested', {
      requestId: 'request-1',
      target,
      title: 'Refactor project'
    })
    emit('navigation.conversation_focus_or_open_requested', {
      requestId: 'request-2',
      target,
      title: 'Refactor project'
    })

    expect(owner.openTab).toHaveBeenCalledOnce()

    rendered.rerender({
      value: {
        ...owner,
        tabs: [
          {
            id: 'new-agent-tab',
            type: 'route',
            url: '/app/agents',
            title: 'Refactor project',
            metadata: { instanceAppId: 'agents', instanceKey: 'session-1' }
          }
        ]
      }
    })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith('navigation.report_conversation_ownership', {
        requestId: 'request-1',
        ownsTarget: true
      })
      expect(mocks.request).toHaveBeenCalledWith('navigation.report_conversation_ownership', {
        requestId: 'request-2',
        ownsTarget: true
      })
    })
  })
})
