import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

const partsByMessageIdMock = vi.hoisted(() => ({
  value: {} as Record<string, unknown[]>
}))
const topicStreamStatusMock = vi.hoisted(() => ({
  isPending: false
}))

const activeAgentMock = vi.hoisted(() => ({
  value: { id: 'agent-1', model: 'provider:model-1' } as any,
  isLoading: false
}))
const activeModelMock = vi.hoisted(() => ({
  value: { id: 'provider:model-1', name: 'Model 1' } as any,
  isLoading: false
}))
const updateAgentMock = vi.hoisted(() => ({
  updateModel: vi.fn()
}))
const updateSessionMock = vi.hoisted(() => ({
  updateSession: vi.fn()
}))
const modelSwitchConfirmationCacheMock = vi.hoisted(() => ({
  value: false,
  set: vi.fn()
}))
const agentRightPanePropsMock = vi.hoisted(() => ({
  last: undefined as any,
  openAgentToolFlow: vi.fn(),
  openArtifactFile: vi.fn()
}))
const agentComposerPropsMock = vi.hoisted(() => ({
  last: undefined as any
}))
const agentConversationControlsPropsMock = vi.hoisted(() => ({
  last: undefined as any
}))
const conversationShellPropsMock = vi.hoisted(() => ({
  last: undefined as any
}))
const toolApprovalRespondMock = vi.hoisted(() => vi.fn())
const agentSessionRefreshMock = vi.hoisted(() => vi.fn())

// Tool-approval responses now go through ipcApi.request('ai.tool.respond_approval', …).
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) =>
      route === 'ai.tool.respond_approval' ? toolApprovalRespondMock(input) : Promise.resolve(undefined),
    on: () => () => {}
  }
}))

vi.mock('@renderer/components/chat/shell/ConversationCenterState', () => ({
  default: ({ state }: { state: string }) => <div data-testid="conversation-center-state" data-state={state} />
}))

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: (props: {
    topBar?: ReactNode
    topRightTool?: ReactNode
    sidePanel?: ReactNode
    center?: ReactNode
    rightPane?: ReactNode
    overlay?: ReactNode
    showTopRightToolWhenPaneOpen?: boolean
  }) => {
    conversationShellPropsMock.last = props
    return (
      <div>
        <div data-testid="agent-top-bar">{props.topBar}</div>
        <div data-testid="agent-top-right-tool">{props.topRightTool}</div>
        <div data-testid="agent-side-panel">{props.sidePanel}</div>
        <div>{props.center}</div>
        <div>{props.overlay}</div>
        {props.rightPane}
      </div>
    )
  }
}))

vi.mock('@renderer/components/chat/primitives', async (importActual) => ({
  ...(await importActual<typeof ChatPrimitives>()),
  LoadingState: () => <div data-testid="loading-state" />
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
  ),
  PersistentRightPaneHost: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (
    <div data-testid="right-pane-host" data-open={String(Boolean(open))}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/composer/ConversationComposerStage', () => ({
  default: ({ placement, main, composer }: { placement: string; main: ReactNode; composer: ReactNode }) => (
    <div
      data-testid="composer-dock-frame"
      data-placement={placement}
      data-main-visible={String(placement === 'docked')}>
      {main}
      {composer}
    </div>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false],
  useSharedCache: (key: string) =>
    key === 'agent.model_switch_confirmation.skipped'
      ? [modelSwitchConfirmationCacheMock.value, modelSwitchConfirmationCacheMock.set]
      : [null, vi.fn()],
  usePersistCache: () => [undefined, vi.fn()]
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn(),
  useMutation: () => ({
    trigger: vi.fn(),
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({
    agent: activeAgentMock.isLoading ? undefined : activeAgentMock.value,
    isLoading: activeAgentMock.isLoading
  }),
  useAgents: () => ({
    agents: [{ id: 'agent-1' }],
    isLoading: false
  }),
  useUpdateAgent: () => updateAgentMock
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useUpdateSession: () => updateSessionMock
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (modelId?: string | null) => ({
    model: modelId && !activeModelMock.isLoading ? activeModelMock.value : undefined,
    isLoading: activeModelMock.isLoading
  })
}))

vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({
  useAgentWorkspaceWarning: () => undefined
}))

vi.mock('@renderer/components/composer/variants/agent/AgentConversationControls', () => ({
  AgentConversationControls: (props: any) => {
    agentConversationControlsPropsMock.last = props
    return (
      <div
        data-testid="agent-conversation-controls"
        data-agent-trigger-mode={props.agentTriggerMode}
        data-can-change-workspace={String(Boolean(props.onWorkspaceChange))}
        data-can-change-model={String(Boolean(props.canChangeModel))}>
        <button type="button" onClick={() => void props.onWorkspaceChange?.('workspace-next')}>
          change topbar workspace
        </button>
        <button type="button" onClick={() => void props.onModelSelect?.({ id: 'provider:model-2', name: 'Model 2' })}>
          change topbar model
        </button>
      </div>
    )
  }
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

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: topicStreamStatusMock.isPending }),
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
  AgentChatNavbar: ({ conversationControls }: { conversationControls?: ReactNode }) => (
    <div data-testid="agent-navbar">{conversationControls}</div>
  )
}))

vi.mock('../components/AgentRightPane', () => {
  const MockAgentRightPaneScope = ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => {
    agentRightPanePropsMock.last = props
    return <div data-testid="agent-right-pane">{children}</div>
  }

  return {
    AgentRightPane: {
      Scope: MockAgentRightPaneScope,
      Shell: ({ children }: PropsWithChildren) => <>{children}</>,
      Viewport: () => <div data-testid="agent-right-pane-viewport" />,
      Shortcuts: () => <button type="button">Shortcuts</button>
    },
    useAgentRightPaneActions: () => ({
      canOpenAgentToolFlow: true,
      canOpenArtifactFile: true,
      openAgentToolFlow: agentRightPanePropsMock.openAgentToolFlow,
      openArtifactFile: agentRightPanePropsMock.openArtifactFile
    })
  }
})

vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: (props: any) => {
    agentComposerPropsMock.last = props
    return (
      <div
        data-testid="agent-composer"
        data-external-context-controls={String(Boolean(props.externalContextControls))}
        data-resolved-agent-id={props.resolvedAgent?.id}
        data-resolved-model-id={props.resolvedModel?.id}
      />
    )
  },
  AgentHomeComposer: () => <div data-testid="agent-home-composer" />,
  MissingAgentHomeComposer: () => <div data-testid="missing-agent-home-composer" />
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
    topicStreamStatusMock.isPending = false
    activeAgentMock.value = { id: 'agent-1', model: 'provider:model-1' }
    activeAgentMock.isLoading = false
    activeModelMock.value = { id: 'provider:model-1', name: 'Model 1' }
    activeModelMock.isLoading = false
    modelSwitchConfirmationCacheMock.value = false
    modelSwitchConfirmationCacheMock.set.mockReset()
    modelSwitchConfirmationCacheMock.set.mockImplementation((value: boolean) => {
      modelSwitchConfirmationCacheMock.value = value
    })
    agentRightPanePropsMock.last = undefined
    agentComposerPropsMock.last = undefined
    agentConversationControlsPropsMock.last = undefined
    conversationShellPropsMock.last = undefined
    updateAgentMock.updateModel.mockReset()
    updateAgentMock.updateModel.mockResolvedValue({ id: 'agent-1' })
    updateSessionMock.updateSession.mockReset()
    agentRightPanePropsMock.openAgentToolFlow.mockReset()
    agentRightPanePropsMock.openArtifactFile.mockReset()
    toolApprovalRespondMock.mockReset()
    toolApprovalRespondMock.mockResolvedValue({ ok: true })
    agentSessionRefreshMock.mockReset()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {}
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

  it('keeps right-pane shortcuts visible without the expand button', () => {
    renderAgentChat()

    expect(screen.getByRole('button', { name: 'Shortcuts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull()
    expect(conversationShellPropsMock.last?.showTopRightToolWhenPaneOpen).toBe(true)
  })

  it('passes the session runtime directly to the right-pane scope', () => {
    const part = { type: 'text', text: 'runtime message' }
    partsByMessageIdMock.value = { 'message-1': [part] }

    renderAgentChat()

    expect(agentRightPanePropsMock.last?.messages).toEqual([
      expect.objectContaining({ id: 'message-1', parts: [part] })
    ])
    expect(agentRightPanePropsMock.last?.partsByMessageId).toEqual({ 'message-1': [part] })
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

  it('resolves session context above the composer and changes an empty session workspace from the top bar', () => {
    const onSessionWorkspaceChange = vi.fn()

    renderAgentChat({
      activeSession: {
        id: 'session-1',
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
        workspace: { id: 'workspace-1', type: 'user', name: 'Workspace 1', path: '/workspace' }
      } as any,
      onSessionWorkspaceChange
    })

    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-workspace', 'true')
    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-agent-trigger-mode', 'selector')
    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-model', 'true')
    expect(screen.getByTestId('agent-composer')).toHaveAttribute('data-external-context-controls', 'true')
    expect(screen.getByTestId('agent-composer')).toHaveAttribute('data-resolved-agent-id', 'agent-1')
    expect(screen.getByTestId('agent-composer')).toHaveAttribute('data-resolved-model-id', 'provider:model-1')
    expect(agentConversationControlsPropsMock.last?.workspaceId).toBe('workspace-1')
    expect(agentComposerPropsMock.last?.onWorkspaceChange).toBeUndefined()
    expect(agentComposerPropsMock.last?.onAgentChange).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'change topbar workspace' }))

    expect(onSessionWorkspaceChange).toHaveBeenCalledWith('workspace-next')
  })

  it('mounts the composer while the page-owned model is resolving', () => {
    activeModelMock.isLoading = true

    const { container } = renderAgentChat()

    expect(screen.getByTestId('agent-conversation-controls')).toBeInTheDocument()
    expect(screen.getByTestId('agent-composer')).toBeInTheDocument()
    expect(screen.getByTestId('agent-composer')).not.toHaveAttribute('data-resolved-model-id')
    expect(agentComposerPropsMock.last?.sendDisabled).toBe(true)
    expect(container.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()
  })

  it('mounts the composer while the page-owned agent is resolving', () => {
    activeAgentMock.isLoading = true

    const { container } = renderAgentChat()

    expect(screen.getByTestId('agent-composer')).toBeInTheDocument()
    expect(screen.getByTestId('agent-composer')).not.toHaveAttribute('data-resolved-agent-id')
    expect(agentComposerPropsMock.last?.agentId).toBe('agent-1')
    expect(agentComposerPropsMock.last?.sendDisabled).toBe(true)
    expect(container.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()
  })

  it('keeps the composer mounted during later model changes', () => {
    const activeSession = { id: 'session-1', agentId: 'agent-1', accessiblePaths: [] } as any
    const { container, rerender } = render(<AgentChat activeSession={activeSession} activeSessionSource="query" />)

    expect(screen.getByTestId('agent-composer')).toBeInTheDocument()

    activeModelMock.isLoading = true
    rerender(<AgentChat activeSession={activeSession} activeSessionSource="query" />)

    expect(screen.getByTestId('agent-composer')).toBeInTheDocument()
    expect(container.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()
  })

  it('shows the empty-session greeting when the loaded session has no messages', () => {
    renderAgentChat()

    expect(screen.getByTestId('conversation-greeting')).toBeInTheDocument()
  })

  it('hides the empty-session greeting once the session has messages', () => {
    partsByMessageIdMock.value = { 'message-1': [{ type: 'text', text: 'hello' } as any] }

    renderAgentChat()

    expect(screen.queryByTestId('conversation-greeting')).toBeNull()
  })

  it('keeps the greeting hidden while session messages are disabled during the locked/active switch window', () => {
    // hasLockedSession makes the locked session the snapshot; the active session
    // pointing elsewhere means sessionMessagesEnabled=false — the transition
    // window where messages are force-empty but the conversation is not empty.
    renderAgentChat({
      lockedSession: { id: 'session-locked', agentId: 'agent-1', accessiblePaths: [] } as any,
      activeSession: { id: 'session-1', agentId: 'agent-1', accessiblePaths: [] } as any
    })

    expect(screen.queryByTestId('conversation-greeting')).toBeNull()
  })

  it('does not allow switching the workspace while the empty session is pending', () => {
    topicStreamStatusMock.isPending = true

    renderAgentChat({
      activeSession: {
        id: 'session-1',
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
        workspace: { id: 'workspace-1', type: 'user', name: 'Workspace 1', path: '/workspace' }
      } as any,
      onSessionWorkspaceChange: vi.fn()
    })

    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-workspace', 'false')
    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-agent-trigger-mode', 'edit')
    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-model', 'true')
  })

  it('does not allow switching the workspace after messages are present', () => {
    partsByMessageIdMock.value = {
      'message-1': [{ type: 'text', text: 'hello' }]
    }

    renderAgentChat({
      activeSession: {
        id: 'session-1',
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
        workspace: { id: 'workspace-1', type: 'user', name: 'Workspace 1', path: '/workspace' }
      } as any,
      onSessionWorkspaceChange: vi.fn()
    })

    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-workspace', 'false')
    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-agent-trigger-mode', 'edit')
    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-model', 'true')
  })

  it('keeps the model selector editable after messages are present when the agent has no model', () => {
    partsByMessageIdMock.value = {
      'message-1': [{ type: 'text', text: 'hello' }]
    }
    activeAgentMock.value = { id: 'agent-1', model: null }

    renderAgentChat({
      activeSession: {
        id: 'session-1',
        agentId: 'agent-1',
        workspaceId: 'workspace-1',
        workspace: { id: 'workspace-1', type: 'user', name: 'Workspace 1', path: '/workspace' }
      } as any,
      onSessionWorkspaceChange: vi.fn()
    })

    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-workspace', 'false')
    expect(screen.getByTestId('agent-conversation-controls')).toHaveAttribute('data-can-change-model', 'true')
  })

  it('switches the model directly when the session has no messages', async () => {
    renderAgentChat()

    fireEvent.click(screen.getByRole('button', { name: 'change topbar model' }))

    await waitFor(() =>
      expect(updateAgentMock.updateModel).toHaveBeenCalledWith('agent-1', 'provider:model-2', {
        showSuccessToast: false
      })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks for confirmation before switching the model when the session has messages', async () => {
    partsByMessageIdMock.value = {
      'message-1': [{ type: 'text', text: 'hello' }]
    }

    renderAgentChat()

    fireEvent.click(screen.getByRole('button', { name: 'change topbar model' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('agent.session.model_switch_confirm.description')
    expect(updateAgentMock.updateModel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'agent.session.model_switch_confirm.skip_for_app_run' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateAgentMock.updateModel).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'change topbar model' }))
    expect(
      screen.getByRole('checkbox', { name: 'agent.session.model_switch_confirm.skip_for_app_run' })
    ).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'agent.session.model_switch_confirm.confirm' }))

    await waitFor(() =>
      expect(updateAgentMock.updateModel).toHaveBeenCalledWith('agent-1', 'provider:model-2', {
        showSuccessToast: false
      })
    )
  })

  it('shares the model confirmation opt-out for the current app run when requested', async () => {
    partsByMessageIdMock.value = {
      'message-1': [{ type: 'text', text: 'hello' }]
    }

    renderAgentChat()

    fireEvent.click(screen.getByRole('button', { name: 'change topbar model' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'agent.session.model_switch_confirm.skip_for_app_run' }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.session.model_switch_confirm.confirm' }))

    await waitFor(() => expect(modelSwitchConfirmationCacheMock.set).toHaveBeenCalledWith(true))
  })

  it('skips model confirmations when the app-run shared cache is enabled', async () => {
    partsByMessageIdMock.value = {
      'message-1': [{ type: 'text', text: 'hello' }]
    }
    modelSwitchConfirmationCacheMock.value = true

    renderAgentChat()

    fireEvent.click(screen.getByRole('button', { name: 'change topbar model' }))

    await waitFor(() => expect(updateAgentMock.updateModel).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('keeps the missing-agent home composer for pending ask-user-question requests', async () => {
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
      missingAgentSelection: true
    })

    // The home composer is lazy-loaded; wait for the chunk to resolve.
    expect(await screen.findByTestId('missing-agent-home-composer')).toBeInTheDocument()
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'docked')
    expect(screen.queryByText('Choose logger')).not.toBeInTheDocument()
  })

  it('prioritizes AskUserQuestionComposer over regular permission requests', async () => {
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

    expect(screen.getByRole('heading', { name: 'message.processing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.toolPermission.button.allow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.toolPermission.button.deny' })).toBeInTheDocument()
    expect(screen.queryByTestId('agent-inputbar')).not.toBeInTheDocument()
  })

  it('keeps the missing-agent home composer for pending tool permissions', async () => {
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
      missingAgentSelection: true
    })

    // The home composer is lazy-loaded; wait for the chunk to resolve.
    expect(await screen.findByTestId('missing-agent-home-composer')).toBeInTheDocument()
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'docked')
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
