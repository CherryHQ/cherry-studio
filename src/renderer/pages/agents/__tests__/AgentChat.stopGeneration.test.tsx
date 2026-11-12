import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen } from '@testing-library/react'
import { type ComponentProps, type ReactNode, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandFocusScope } from '@renderer/components/command/CommandFocusScope'
import { CommandProvider } from '@renderer/components/command/CommandProvider'
import { TabIdProvider } from '@renderer/components/layout/TabIdProvider'
import { TabIdContext } from '@renderer/hooks/tab/useCurrentTab'
import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab/useTabsContext'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { platform } from '@renderer/utils/platform'

import AgentChat from '../AgentChat'

const state = vi.hoisted(() => ({
  runtime: {
    sessionId: 'session-1',
    isPending: true,
    isLoading: false,
    uiMessages: [],
    hasOlder: false,
    stop: vi.fn()
  }
}))

const mockRuntime = vi.fn()
vi.mock('../useAgentChatRuntimeState', () => ({
  useAgentChatRuntimeState: (options: { sessionId: string }) => mockRuntime(options)
}))
vi.mock('@renderer/hooks/agent/useAgent', () => ({ useUpdateAgent: () => ({ updateModel: vi.fn() }) }))
vi.mock('@renderer/hooks/agent/useSession', () => ({ useUpdateSession: () => ({ updateSession: vi.fn() }) }))
vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({ useAgentWorkspaceWarning: () => undefined }))
vi.mock('../components/AgentChatNavbar', () => ({ AgentChatNavbar: () => null }))
vi.mock('../AgentChatMain', () => ({ default: () => null }))
vi.mock('../AgentComposerSlot', () => ({ default: () => null }))
vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({ default: () => null }))
vi.mock('../components/AgentRightPane', () => ({
  AgentRightPane: {
    Scope: ({ children }: { children: ReactNode }) => children,
    DetailsLayout: ({ children }: { children: ReactNode }) => children,
    Viewport: () => null
  },
  AgentTaskProgressCapsule: () => null
}))

function Conversation({ children, activeTabId }: { children: ReactNode; activeTabId: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <TabsContext value={{ activeTabId } as TabsContextValue}>
      <TabIdContext value="agent-tab">
        <CommandProvider>
          <CommandFocusScope rootRef={rootRef}>
            <div ref={rootRef}>
              <textarea aria-label="Agent message" />
              {children}
            </div>
          </CommandFocusScope>
        </CommandProvider>
      </TabIdContext>
    </TabsContext>
  )
}

describe('AgentChat Stop Generation shortcut', () => {
  beforeEach(() => {
    mockRuntime.mockImplementation(() => state.runtime)
    state.runtime = {
      sessionId: 'session-1',
      isPending: true,
      isLoading: false,
      uiMessages: [],
      hasOlder: false,
      stop: vi.fn()
    }
  })

  it.each([
    'pending',
    'idle',
    'inactive',
    'missing-session',
    'mismatched-session',
    'center-surface',
    'history-loading',
    'prevented'
  ])('dispatches only to the eligible conversation (%s)', (scenario) => {
    state.runtime.isPending = scenario !== 'idle'
    state.runtime.isLoading = scenario === 'history-loading'
    if (scenario === 'mismatched-session') state.runtime.sessionId = 'old-session'
    const bootstrap = {
      session: scenario === 'missing-session' ? null : { id: 'session-1', agentId: 'agent-1' },
      sessionLoading: false,
      sessionSource: 'query',
      resources: { agentLoading: false, modelLoading: false }
    } as ComponentProps<typeof AgentChat>['conversationBootstrap']
    render(
      <Conversation activeTabId={scenario === 'inactive' ? 'other-tab' : 'agent-tab'}>
        <AgentChat
          conversationBootstrap={bootstrap}
          centerSurface={scenario === 'center-surface' ? { content: <div>History</div> } : undefined}
        />
      </Conversation>
    )
    const event = new KeyboardEvent('keydown', {
      key: 'S',
      code: 'KeyS',
      shiftKey: true,
      metaKey: platform === 'darwin',
      ctrlKey: platform !== 'darwin',
      bubbles: true,
      cancelable: true
    })
    if (scenario === 'prevented') event.preventDefault()
    fireEvent(screen.getByRole('textbox', { name: 'Agent message' }), event)
    const eligible = scenario === 'pending' || scenario === 'history-loading'
    expect(state.runtime.stop).toHaveBeenCalledTimes(eligible ? 1 : 0)
    expect(event.defaultPrevented).toBe(eligible || scenario === 'prevented')
  })

  function SessionScope({ sessionId, tabId, active }: { sessionId: string; tabId: string; active: boolean }) {
    const rootRef = useRef<HTMLDivElement>(null)
    const bootstrap = {
      session: { id: sessionId, agentId: 'agent-1' },
      sessionLoading: false,
      sessionSource: 'query',
      resources: { agentLoading: false, modelLoading: false }
    } as ComponentProps<typeof AgentChat>['conversationBootstrap']
    return (
      <CommandFocusScope rootRef={rootRef} active={active}>
        <TabIdProvider tabId={tabId}>
          <div ref={rootRef}>
            <textarea aria-label={`Message ${tabId}`} />
            <AgentChat conversationBootstrap={bootstrap} />
          </div>
        </TabIdProvider>
      </CommandFocusScope>
    )
  }

  function AgentTabs({ activeTabId = 'agent-a', firstSessionId = 'session-1' }) {
    return (
      <TabsContext value={{ activeTabId } as TabsContextValue}>
        <CommandProvider>
          <SessionScope tabId="agent-a" sessionId={firstSessionId} active={activeTabId === 'agent-a'} />
          <SessionScope tabId="agent-b" sessionId="session-2" active={activeTabId === 'agent-b'} />
        </CommandProvider>
      </TabsContext>
    )
  }

  function setStreamStatus(sessionId: string, status: 'pending' | 'streaming' | 'done' | 'aborted') {
    MockUseCacheUtils.setSharedCacheValue(`topic.stream.statuses.${sessionId}`, {
      status,
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: undefined
    })
  }

  function observeSessionStops() {
    const stop = vi.fn<(owner: { sessionId: string }) => void>()
    mockRuntime.mockImplementation(function useSessionRuntime({ sessionId }: { sessionId: string }) {
      const { isPending } = useTopicStreamStatus(sessionId)
      return { ...state.runtime, sessionId, isPending, stop: () => stop({ sessionId }) }
    })
    return stop
  }

  function shortcut(target: HTMLElement) {
    const event = new KeyboardEvent('keydown', {
      key: 'S',
      code: 'KeyS',
      shiftKey: true,
      metaKey: platform === 'darwin',
      ctrlKey: platform !== 'darwin',
      bubbles: true,
      cancelable: true
    })
    fireEvent(target, event)
    return event
  }

  it('cancels only the active session and follows tab switches while leaving the background live', () => {
    const stop = observeSessionStops()
    setStreamStatus('session-1', 'streaming')
    setStreamStatus('session-2', 'streaming')
    const view = render(<AgentTabs />)
    const first = screen.getByRole('textbox', { name: 'Message agent-a' })
    const second = screen.getByRole('textbox', { name: 'Message agent-b' })
    expect(shortcut(first).defaultPrevented).toBe(true)
    expect(stop.mock.calls).toEqual([[{ sessionId: 'session-1' }]])
    stop.mockClear()
    setStreamStatus('session-1', 'done')
    view.rerender(<AgentTabs />)
    expect(shortcut(first).defaultPrevented).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    view.rerender(<AgentTabs activeTabId="agent-b" />)
    expect(shortcut(second).defaultPrevented).toBe(true)
    expect(stop.mock.calls).toEqual([[{ sessionId: 'session-2' }]])
    stop.mockClear()
    setStreamStatus('session-1', 'streaming')
    view.rerender(<AgentTabs />)
    expect(shortcut(first).defaultPrevented).toBe(true)
    expect(stop.mock.calls).toEqual([[{ sessionId: 'session-1' }]])
  })

  it('updates mounted eligibility through pending before text, streaming, terminal, and a new session owner', () => {
    const stop = observeSessionStops()
    setStreamStatus('session-1', 'done')
    setStreamStatus('session-2', 'streaming')
    const view = render(<AgentTabs />)
    const first = screen.getByRole('textbox', { name: 'Message agent-a' })
    for (const status of ['done', 'pending', 'streaming', 'aborted'] as const) {
      setStreamStatus('session-1', status)
      // The unified cache mock is per-render; production subscribes via useSyncExternalStore (useCache.ts:399).
      view.rerender(<AgentTabs />)
      expect(screen.getByRole('textbox', { name: 'Message agent-a' })).toBe(first)
      stop.mockClear()
      const live = status === 'pending' || status === 'streaming'
      expect(shortcut(first).defaultPrevented).toBe(live)
      expect(stop.mock.calls).toEqual(live ? [[{ sessionId: 'session-1' }]] : [])
    }
    setStreamStatus('session-new', 'pending')
    view.rerender(<AgentTabs firstSessionId="session-new" />)
    expect(screen.getByRole('textbox', { name: 'Message agent-a' })).toBe(first)
    expect(shortcut(first).defaultPrevented).toBe(true)
    expect(stop.mock.calls).toEqual([[{ sessionId: 'session-new' }]])
  })
})
