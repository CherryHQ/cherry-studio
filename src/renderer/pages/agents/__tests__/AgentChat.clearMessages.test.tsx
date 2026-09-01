import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { useCommandHandler, useCommandRuntime } from '@renderer/hooks/command'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { mockUseInvalidateCache } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

const clearSessionMessagesMock = vi.hoisted(() => vi.fn(async () => undefined))
const activeTabMock = vi.hoisted(() => ({ current: true }))

function lastInvalidateCache(): ReturnType<typeof mockUseInvalidateCache> {
  const invalidate = mockUseInvalidateCache.mock.results.at(-1)?.value
  if (!invalidate) throw new Error('Expected AgentChat to call useInvalidateCache')
  return invalidate
}

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

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => activeTabMock.current
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
    stop: vi.fn(),
    clearMessages: clearSessionMessagesMock,
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

function ExecuteClearMessages() {
  const runtime = useCommandRuntime()
  return (
    <button type="button" onClick={() => runtime.execute('topic.clear_messages')}>
      Clear messages
    </button>
  )
}

function FallbackClearMessages({ onExecute }: { onExecute: () => void }) {
  useCommandHandler('topic.clear_messages', onExecute)
  return null
}

function renderAgentChat(
  props: ComponentProps<typeof AgentChat> = { conversationBootstrap: createConversationBootstrap() },
  fallback?: () => void
) {
  return render(
    <CommandContextKeyProvider>
      <CommandProvider>
        {fallback ? <FallbackClearMessages onExecute={fallback} /> : null}
        <AgentChat {...props} />
        <ExecuteClearMessages />
      </CommandProvider>
    </CommandContextKeyProvider>
  )
}

describe('AgentChat clear messages command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeTabMock.current = true
  })

  it('clears and invalidates the active Agent session after confirmation', async () => {
    const user = userEvent.setup()
    renderAgentChat()
    const invalidateCache = lastInvalidateCache()

    await user.click(screen.getByRole('button', { name: 'Clear messages' }))

    expect(popup.confirm).toHaveBeenCalledWith({
      title: 'chat.input.clear.title',
      content: 'chat.input.clear.content',
      centered: true
    })
    await waitFor(() => {
      expect(clearSessionMessagesMock).toHaveBeenCalledOnce()
      expect(invalidateCache).toHaveBeenCalledExactlyOnceWith([
        '/agent-sessions/session-1/messages',
        '/search/contents'
      ])
    })
  })

  it('leaves Agent messages untouched when the confirmation is dismissed', async () => {
    const user = userEvent.setup()
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)

    renderAgentChat()
    const invalidateCache = lastInvalidateCache()

    await user.click(screen.getByRole('button', { name: 'Clear messages' }))

    expect(clearSessionMessagesMock).not.toHaveBeenCalled()
    expect(invalidateCache).not.toHaveBeenCalled()
  })

  it('reports a failed clear without invalidating the retained messages', async () => {
    const user = userEvent.setup()
    clearSessionMessagesMock.mockRejectedValueOnce(new Error('disk full'))

    renderAgentChat()
    const invalidateCache = lastInvalidateCache()

    await user.click(screen.getByRole('button', { name: 'Clear messages' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('message.error.unknown: Error: disk full')
      expect(invalidateCache).not.toHaveBeenCalled()
    })
  })

  it('lets the active fallback handle the command when this Agent tab is in the background', async () => {
    const user = userEvent.setup()
    const fallback = vi.fn()
    activeTabMock.current = false

    renderAgentChat({ conversationBootstrap: createConversationBootstrap() }, fallback)

    await user.click(screen.getByRole('button', { name: 'Clear messages' }))

    expect(fallback).toHaveBeenCalledOnce()
    expect(clearSessionMessagesMock).not.toHaveBeenCalled()
  })
})
