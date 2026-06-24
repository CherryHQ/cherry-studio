import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

const partsByMessageIdMock = vi.hoisted(() => ({
  value: {} as Record<string, unknown[]>
}))

const activeAgentMock = vi.hoisted(() => ({
  value: { id: 'agent-1', model: 'provider:model-1' } as any
}))
const agentRightPanePropsMock = vi.hoisted(() => ({
  last: undefined as any,
  openAgentToolFlow: vi.fn(),
  openArtifactFile: vi.fn(),
  openTrace: vi.fn()
}))
const toolApprovalRespondMock = vi.hoisted(() => vi.fn())
const agentSessionRefreshMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/chat', () => ({
  ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 460,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH: 540,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH: 360,
  ConversationCenterState: ({ state }: { state: string }) => (
    <div data-testid="conversation-center-state" data-state={state} />
  ),
  ConversationShell: ({
    topBar,
    sidePanel,
    center,
    rightPane,
    overlay
  }: {
    topBar?: ReactNode
    sidePanel?: ReactNode
    center?: ReactNode
    rightPane?: ReactNode
    overlay?: ReactNode
  }) => (
    <div>
      <div data-testid="agent-top-bar">{topBar}</div>
      <div data-testid="agent-side-panel">{sidePanel}</div>
      <div>{center}</div>
      <div>{overlay}</div>
      {rightPane}
    </div>
  ),
  LoadingState: () => <div data-testid="loading-state" />,
  RightPaneHost: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (
    <div data-testid="right-pane-host" data-open={String(Boolean(open))}>
      {open ? children : null}
    </div>
  )
}))

vi.mock('@renderer/components/chat/shell/RightPaneHost', () => ({
  ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 460,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH: 540,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH: 360,
  RightPaneHost: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (
    <div data-testid="right-pane-host" data-open={String(Boolean(open))}>
      {open ? children : null}
    </div>
  )
}))

vi.mock('@renderer/components/chat/panes/Shell/Shell', () => ({
  useShellActions: () => ({
    close: vi.fn()
  }),
  useOptionalShellState: () => ({
    activeTab: 'files',
    maximized: false,
    open: false,
    pdfLayoutPending: false,
    pdfLayoutRefreshKey: 0
  })
}))

vi.mock('@renderer/components/chat/panes/Shell', () => ({
  useShellActions: () => ({
    close: vi.fn()
  }),
  useOptionalShellState: () => ({
    activeTab: 'files',
    maximized: false,
    open: false,
    pdfLayoutPending: false,
    pdfLayoutRefreshKey: 0
  })
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/chat/composer/ConversationComposerStage', () => ({
  default: ({
    placement,
    main,
    composer,
    homeWelcomeText
  }: {
    placement: string
    main: ReactNode
    composer: ReactNode
    homeWelcomeText?: string
  }) => (
    <div
      data-testid="composer-dock-frame"
      data-placement={placement}
      data-main-visible={String(placement === 'docked')}>
      <div data-testid="composer-dock-home-header">{placement === 'home' ? homeWelcomeText : null}</div>
      {main}
      {composer}
    </div>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false],
  useSharedCache: () => [null, vi.fn()],
  usePersistCache: () => [undefined, vi.fn()]
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
    agent: activeAgentMock.value,
    isLoading: false
  }),
  useAgents: () => ({
    agents: [{ id: 'agent-1' }],
    isLoading: false
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
    refresh: agentSessionRefreshMock
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
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicOverlayHandoffOnTerminal: () => {}
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

vi.mock('../components/AgentRightPane', () => {
  const MockAgentRightPane = Object.assign(
    ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => {
      agentRightPanePropsMock.last = props
      return <div data-testid="agent-right-pane">{children}</div>
    },
    {
      Host: () => <div data-testid="agent-right-pane-host" />,
      MaximizedOverlay: () => <div data-testid="agent-right-pane-overlay" />,
      FilesToggle: ({ disabled }: { disabled?: boolean }) => (
        <button type="button" disabled={disabled}>
          Files
        </button>
      ),
      InfoCard: ({ disabled }: { disabled?: boolean }) => (
        <button type="button" disabled={disabled}>
          Info
        </button>
      )
    }
  )

  return {
    AgentRightPane: MockAgentRightPane,
    useAgentRightPaneActions: () => ({
      openAgentToolFlow: agentRightPanePropsMock.openAgentToolFlow,
      openArtifactFile: agentRightPanePropsMock.openArtifactFile,
      openTrace: agentRightPanePropsMock.openTrace
    })
  }
})

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

describe('AgentChat settings panel', () => {
  const renderAgentChat = (props: ComponentProps<typeof AgentChat> = {}) =>
    render(
      <AgentChat
        activeSession={{ id: 'session-1', agentId: 'agent-1', accessiblePaths: [] } as any}
        activeSessionSource="query"
        {...props}
      />
    )

  beforeEach(() => {
    partsByMessageIdMock.value = {}
    activeAgentMock.value = { id: 'agent-1', model: 'provider:model-1' }
    agentRightPanePropsMock.last = undefined
    agentRightPanePropsMock.openAgentToolFlow.mockReset()
    agentRightPanePropsMock.openArtifactFile.mockReset()
    agentRightPanePropsMock.openTrace.mockReset()
    toolApprovalRespondMock.mockReset()
    toolApprovalRespondMock.mockResolvedValue({ ok: true })
    agentSessionRefreshMock.mockReset()
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
    renderAgentChat()

    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'open citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-count', '1')

    fireEvent.click(screen.getByRole('button', { name: 'close citations' }))
    expect(screen.getByTestId('citations-panel')).toHaveAttribute('data-open', 'false')
  })

  it('normalizes blank agent avatars before passing them to the right pane', () => {
    activeAgentMock.value = {
      id: 'agent-1',
      name: 'Blank avatar agent',
      model: 'provider:model-1',
      configuration: { avatar: '   ' }
    }

    renderAgentChat()

    expect(agentRightPanePropsMock.last?.agentAvatar).toBe('🤖')
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

    renderAgentChat()

    expect(screen.getByText('Choose logger')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-inputbar')).not.toBeInTheDocument()
  })

  it('keeps the agent home composer for pending ask-user-question requests', () => {
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

    renderAgentChat({
      activeSession: null,
      draftConversation: {
        agentId: 'agent-1',
        workspaceSource: { type: 'user', workspaceId: 'workspace-1' },
        workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user' }
      } as any
    })

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('agent-home-composer')).toBeInTheDocument()
    expect(screen.queryByText('Choose logger')).not.toBeInTheDocument()
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

    renderAgentChat()

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

    renderAgentChat()

    expect(screen.getByText('CustomTool')).toBeInTheDocument()
    expect(screen.getByText('agent.toolPermission.confirmation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.toolPermission.button.allow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.toolPermission.button.deny' })).toBeInTheDocument()
    expect(screen.queryByTestId('agent-inputbar')).not.toBeInTheDocument()
  })

  it('keeps the agent home composer for pending tool permissions', () => {
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

    renderAgentChat({
      activeSession: null,
      draftConversation: {
        agentId: 'agent-1',
        workspaceSource: { type: 'user', workspaceId: 'workspace-1' },
        workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user' }
      } as any
    })

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('agent-home-composer')).toBeInTheDocument()
    expect(screen.queryByText('CustomTool')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.toolPermission.button.allow' })).not.toBeInTheDocument()
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

    renderAgentChat()

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
