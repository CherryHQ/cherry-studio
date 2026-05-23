import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

const partsByMessageIdMock = vi.hoisted(() => ({
  value: {} as Record<string, unknown[]>
}))

const toolApprovalRespondMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/chat', () => ({
  ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 460,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH: 540,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH: 360,
  ChatAppShell: ({
    topBar,
    sidePanel,
    main,
    centerContent,
    bottomComposer,
    overlay
  }: {
    topBar?: ReactNode
    sidePanel?: ReactNode
    main?: ReactNode
    centerContent?: ReactNode
    bottomComposer?: ReactNode
    overlay?: ReactNode
  }) => (
    <div>
      <div data-testid="agent-top-bar">{topBar}</div>
      <div data-testid="agent-side-panel">{sidePanel}</div>
      <div>{centerContent ?? main}</div>
      <div>{bottomComposer}</div>
      <div>{overlay}</div>
    </div>
  ),
  EmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
  LoadingState: () => <div data-testid="loading-state" />,
  RightPaneHost: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (
    <div data-testid="right-pane-host" data-open={String(Boolean(open))}>
      {open ? children : null}
    </div>
  )
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/chat/composer/ComposerDockTransitionFrame', () => ({
  default: ({
    placement,
    main,
    composer,
    mainVisible
  }: {
    placement: string
    main: ReactNode
    composer: ReactNode
    mainVisible?: boolean
  }) => (
    <div data-testid="composer-dock-frame" data-placement={placement} data-main-visible={String(Boolean(mainVisible))}>
      {main}
      {composer}
    </div>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false]
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn(),
  useMutation: () => ({
    trigger: vi.fn(),
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({
    agent: { id: 'agent-1', model: 'provider:model-1' },
    isLoading: false
  }),
  useAgents: () => ({
    agents: [{ id: 'agent-1' }],
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useActiveSession: () => ({
    session: { id: 'session-1', agentId: 'agent-1', accessiblePaths: [] },
    isLoading: false,
    setActiveSessionId: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => ({
    messages: Object.entries(partsByMessageIdMock.value).map(([id, parts]) => ({
      id,
      role: 'assistant',
      parts,
      metadata: { createdAt: '2026-01-01T00:00:00.000Z', status: 'pending' }
    })),
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    refresh: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({
    activeExecutions: [],
    sendMessage: vi.fn(),
    stop: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    overlay: {},
    liveAssistants: [],
    disposeOverlay: vi.fn(),
    reset: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    messageNavigation: 'none',
    messageStyle: 'message-style'
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false })
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentSessionTopicId: (sessionId: string) => `agent-session:${sessionId}`
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/AgentChatNavbar', () => ({
  default: () => <div data-testid="agent-navbar" />
}))

vi.mock('@renderer/components/chat/composer/variants/AgentComposer', () => ({
  default: () => <div data-testid="agent-composer" />,
  AgentHomeComposer: () => <div data-testid="agent-home-composer" />
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: ({ onOpenCitationsPanel }: { onOpenCitationsPanel: (payload: { citations: unknown[] }) => void }) => (
    <div data-testid="agent-messages">
      <button type="button" onClick={() => onOpenCitationsPanel({ citations: [{ number: 1 }] })}>
        open citations
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: ({ open, onClose, citations }: { open: boolean; onClose: () => void; citations: unknown[] }) => (
    <div data-testid="citations-panel" data-open={String(open)} data-count={citations.length}>
      {open && (
        <button type="button" onClick={onClose}>
          close citations
        </button>
      )}
    </div>
  )
}))

vi.mock('../../home/Inputbar/components/PinnedTodoPanel', () => ({
  PinnedTodoPanel: () => <div data-testid="pinned-todo-panel" />
}))

describe('AgentChat settings panel', () => {
  beforeEach(() => {
    partsByMessageIdMock.value = {}
    toolApprovalRespondMock.mockReset()
    toolApprovalRespondMock.mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          toolApproval: {
            respond: toolApprovalRespondMock
          }
        }
      }
    })
  })

  it('opens and closes the citations panel from agent messages', () => {
    render(<AgentChat />)

    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'open citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-count', '1')

    fireEvent.click(screen.getByRole('button', { name: 'close citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')
  })

  it('shows a not-found state when a locked session is missing', () => {
    render(<AgentChat lockedSession={null} />)

    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.session.get.error.not_found')
    expect(screen.queryByTestId('agent-messages')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-composer')).not.toBeInTheDocument()
  })

  it('replaces the agent inputbar with AskUserQuestionComposer for pending requests', () => {
    partsByMessageIdMock.value = {
      'message-1': [
        {
          type: 'dynamic-tool',
          toolName: 'AskUserQuestion',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: {
            questions: [
              {
                question: 'Choose logger',
                header: 'Logger',
                options: [{ label: 'Winston' }, { label: 'Pino' }],
                multiSelect: false
              }
            ]
          },
          providerExecuted: true,
          callProviderMetadata: { 'claude-code': { parentToolCallId: null } },
          approval: { id: 'approval-1' }
        }
      ]
    }

    render(<AgentChat />)

    expect(screen.getByText('Choose logger')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-inputbar')).not.toBeInTheDocument()
  })

  it('prioritizes AskUserQuestionComposer over regular permission requests', () => {
    partsByMessageIdMock.value = {
      'message-1': [
        {
          type: 'tool-Read',
          toolName: 'Read',
          toolCallId: 'call-read',
          state: 'approval-requested',
          input: { file_path: '/tmp/file.ts' },
          approval: { id: 'approval-read' },
          callProviderMetadata: {
            'claude-code': {
              rawInput: { file_path: '/tmp/file.ts' },
              parentToolCallId: null
            }
          }
        },
        {
          type: 'dynamic-tool',
          toolName: 'AskUserQuestion',
          toolCallId: 'call-ask',
          state: 'approval-requested',
          input: {
            questions: [
              {
                question: 'Choose logger',
                header: 'Logger',
                options: [{ label: 'Winston' }, { label: 'Pino' }],
                multiSelect: false
              }
            ]
          },
          providerExecuted: true,
          callProviderMetadata: { 'claude-code': { parentToolCallId: null } },
          approval: { id: 'approval-ask' }
        }
      ]
    }

    render(<AgentChat />)

    expect(screen.getByText('Choose logger')).toBeInTheDocument()
    expect(screen.queryByText('Read')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-inputbar')).not.toBeInTheDocument()
  })

  it('replaces the agent inputbar with PermissionRequestComposer for pending tool permissions', () => {
    partsByMessageIdMock.value = {
      'message-1': [
        {
          type: 'tool-CustomTool',
          toolName: 'CustomTool',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: { command: 'pnpm test' },
          approval: { id: 'approval-1' },
          callProviderMetadata: {
            'claude-code': {
              rawInput: { command: 'pnpm test' },
              parentToolCallId: null
            }
          }
        }
      ]
    }

    render(<AgentChat />)

    expect(screen.getAllByText('CustomTool')).toHaveLength(1)
    expect(screen.getByText('agent.toolPermission.confirmation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.toolPermission.button.allow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.toolPermission.button.deny' })).toBeInTheDocument()
    expect(screen.queryByTestId('agent-inputbar')).not.toBeInTheDocument()
  })

  it('responds to agent-session approvals with session topic and anchor context', async () => {
    partsByMessageIdMock.value = {
      'message-1': [
        {
          type: 'tool-CustomTool',
          toolName: 'CustomTool',
          toolCallId: 'call-1',
          state: 'approval-requested',
          input: { command: 'pnpm test' },
          approval: { id: 'approval-1' },
          callProviderMetadata: {
            'claude-code': {
              rawInput: { command: 'pnpm test' },
              parentToolCallId: null
            }
          }
        }
      ]
    }

    render(<AgentChat />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.toolPermission.button.allow' }))

    await waitFor(() => expect(toolApprovalRespondMock).toHaveBeenCalledTimes(1))
    const payload = toolApprovalRespondMock.mock.calls[0][0]
    expect(payload).toMatchObject({
      approvalId: 'approval-1',
      approved: true,
      reason: undefined,
      updatedInput: undefined,
      topicId: 'agent-session:session-1',
      anchorId: 'message-1'
    })
  })
})
