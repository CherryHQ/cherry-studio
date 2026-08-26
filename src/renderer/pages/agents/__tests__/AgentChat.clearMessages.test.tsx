import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { act, render } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

const commandHandlers = vi.hoisted(() => new Map<string, () => void | Promise<void>>())
const clearAgentSessionMessagesMock = vi.hoisted(() => vi.fn(async () => undefined))
const stopLiveTurnMock = vi.hoisted(() => vi.fn(async () => undefined))
const activeTabMock = vi.hoisted(() => ({ current: true }))

const session = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  isNameManuallyEdited: false,
  workspaceId: 'workspace-1',
  workspace: {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    type: 'user'
  },
  orderKey: 'a0',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as AgentSessionEntity

const createConversationBootstrap = (
  nextSession: AgentSessionEntity | null = session
): ComponentProps<typeof AgentChat>['conversationBootstrap'] => ({
  session: nextSession,
  sessionLoading: false,
  sessionSource: nextSession ? 'query' : 'none',
  resources: {
    agent: nextSession
      ? ({ id: 'agent-1', type: 'claude-code', name: 'Agent', model: 'provider::model-1' } as any)
      : undefined,
    agentLoading: false,
    model: { id: 'provider::model-1', name: 'Model 1', providerId: 'provider', apiModelId: 'model-1' } as any,
    modelLoading: false
  }
})

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void | Promise<void>, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) commandHandlers.delete(command)
    else commandHandlers.set(command, handler)
  }
}))

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => activeTabMock.current
}))

vi.mock('@renderer/hooks/agent/useClearAgentSessionMessages', () => ({
  useClearAgentSessionMessages: () => clearAgentSessionMessagesMock
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useUpdateAgent: () => ({ updateModel: vi.fn() })
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useUpdateSession: () => ({ updateSession: vi.fn() })
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: () => undefined
}))

vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({
  useAgentWorkspaceWarning: () => undefined
}))

vi.mock('../useAgentChatRuntimeState', () => ({
  useAgentChatRuntimeState: () => ({
    sessionId: 'session-1',
    uiMessages: [],
    partsByMessageId: {},
    isLoading: false,
    isPending: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    sendMessage: vi.fn(),
    stop: stopLiveTurnMock,
    composerContext: undefined,
    streamingLayers: {},
    optimisticAskUserQuestionInputsByToolCallId: {},
    deleteMessage: vi.fn(),
    respondToolApproval: vi.fn()
  })
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false],
  useSharedCache: () => [false, vi.fn()]
}))

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: () => <div data-testid="conversation-shell" />
}))

vi.mock('@renderer/components/chat/shell/ConversationCenterState', () => ({
  default: ({ state }: { state: string }) => <div data-testid="conversation-center-state">{state}</div>
}))

vi.mock('../components/AgentChatNavbar', () => ({
  AgentChatNavbar: ({ conversationControls }: { conversationControls?: ReactNode }) => (
    <div data-testid="agent-navbar">{conversationControls}</div>
  )
}))

vi.mock('../components/AgentRightPane', () => ({
  AgentRightPane: {
    Scope: ({ children }: { children: ReactNode }) => <>{children}</>,
    Viewport: () => <div data-testid="agent-right-pane-viewport" />,
    Shortcuts: () => <div data-testid="agent-right-shortcuts" />
  },
  AgentTaskProgressCapsule: () => null
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: () => <div data-testid="citations-panel" />
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) => `${prefix}: ${String(error)}`
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('AgentChat clear messages command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commandHandlers.clear()
    activeTabMock.current = true
  })

  it('clears the active Agent session once the confirmation is accepted', async () => {
    render(<AgentChat conversationBootstrap={createConversationBootstrap()} />)

    await act(async () => {
      await commandHandlers.get('topic.clear_messages')?.()
    })

    expect(popup.confirm).toHaveBeenCalledWith({
      title: 'chat.input.clear.title',
      content: 'chat.input.clear.content',
      centered: true
    })
    expect(stopLiveTurnMock).toHaveBeenCalled()
    expect(clearAgentSessionMessagesMock).toHaveBeenCalledWith('session-1')
    expect(stopLiveTurnMock.mock.invocationCallOrder[0]).toBeLessThan(
      clearAgentSessionMessagesMock.mock.invocationCallOrder[0]
    )
  })

  it('drains the live turn before clearing so terminal persistence cannot recreate the assistant', async () => {
    let transcript = ['assistant']
    let turnLive = true
    const persistTerminalAssistant = () => {
      transcript = ['assistant']
    }
    stopLiveTurnMock.mockImplementation(async () => {
      persistTerminalAssistant()
      turnLive = false
    })
    clearAgentSessionMessagesMock.mockImplementation(async () => {
      transcript = []
    })

    render(<AgentChat conversationBootstrap={createConversationBootstrap()} />)

    await act(async () => {
      await commandHandlers.get('topic.clear_messages')?.()
    })
    if (turnLive) persistTerminalAssistant()

    expect(transcript).toEqual([])
  })

  it('leaves Agent messages untouched when stopping the live turn fails', async () => {
    stopLiveTurnMock.mockRejectedValueOnce(new Error('abort failed'))

    render(<AgentChat conversationBootstrap={createConversationBootstrap()} />)

    await act(async () => {
      await commandHandlers.get('topic.clear_messages')?.()
    })

    expect(clearAgentSessionMessagesMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('message.error.unknown: Error: abort failed')
  })

  it('leaves Agent messages untouched when the confirmation is dismissed', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)

    render(<AgentChat conversationBootstrap={createConversationBootstrap()} />)

    await act(async () => {
      await commandHandlers.get('topic.clear_messages')?.()
    })

    expect(stopLiveTurnMock).not.toHaveBeenCalled()
    expect(clearAgentSessionMessagesMock).not.toHaveBeenCalled()
  })

  it('toasts the existing localized error when clearing the Agent session fails', async () => {
    clearAgentSessionMessagesMock.mockRejectedValueOnce(new Error('disk full'))

    render(<AgentChat conversationBootstrap={createConversationBootstrap()} />)

    await act(async () => {
      await commandHandlers.get('topic.clear_messages')?.()
    })

    expect(toast.error).toHaveBeenCalledWith('message.error.unknown: Error: disk full')
  })

  it('does not register the clear-messages command for a background tab', () => {
    activeTabMock.current = false

    render(<AgentChat conversationBootstrap={createConversationBootstrap()} />)

    expect(commandHandlers.has('topic.clear_messages')).toBe(false)
  })

  it('does not register the clear-messages command without an active session', () => {
    render(<AgentChat conversationBootstrap={createConversationBootstrap(null)} />)

    expect(commandHandlers.has('topic.clear_messages')).toBe(false)
  })

  it('does not register the clear-messages command when the conversation is not shown', () => {
    render(
      <AgentChat
        conversationBootstrap={createConversationBootstrap()}
        centerSurface={{ id: 'home', content: <div /> }}
      />
    )

    expect(commandHandlers.has('topic.clear_messages')).toBe(false)
  })
})
