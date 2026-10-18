import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as MotionReact from 'motion/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  Badge: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  HoverCard: ({ children }: PropsWithChildren) => <div>{children}</div>,
  HoverCardContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  HoverCardTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
  Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren) => children
}))

// Render the active composer override so the real PermissionRequestComposer mounts exactly as the
// dock would show it for a pending plan approval.
vi.mock('@renderer/components/composer/ComposerCore', async () => {
  const { useActiveComposerOverride } = await import('@renderer/components/composer/ComposerContext')
  return {
    default: ({ fallback }: { fallback: ReactNode }) => <ActiveOverrideHost fallback={fallback} />
  }

  function ActiveOverrideHost({ fallback }: { fallback: ReactNode }) {
    const override = useActiveComposerOverride()
    return <>{override ? override.render({}) : fallback}</>
  }
})

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: ({
    topBar,
    center,
    overlay,
    centerOverlay
  }: {
    topBar?: ReactNode
    center?: ReactNode
    overlay?: ReactNode
    centerOverlay?: ReactNode
  }) => (
    <div data-testid="chat-app-shell">
      <div>{topBar}</div>
      <div>{center}</div>
      <div>{centerOverlay}</div>
      <div>{overlay}</div>
    </div>
  )
}))

vi.mock('@renderer/components/chat/shell/ConversationStageCenter', () => ({
  default: ({ main, composer }: { main: ReactNode; composer: ReactNode }) => (
    <div>
      <div>{main}</div>
      <div>{composer}</div>
    </div>
  )
}))

vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: () => <div data-testid="agent-composer" />,
  AgentHomeComposer: () => <div />,
  MissingAgentHomeComposer: () => <div />
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('../components/AgentChatNavbar', () => ({
  AgentChatNavbar: ({ tools }: { tools?: ReactNode }) => <div data-testid="agent-chat-navbar">{tools}</div>
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: ({ sessionId }: { sessionId: string }) => <div data-testid="agent-messages" data-session-id={sessionId} />
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="citations-panel" data-open={String(open)} />
}))

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof MotionReact>()),
  AnimatePresence: ({ children }: PropsWithChildren) => <>{children}</>,
  useReducedMotion: () => false
}))

vi.mock('@renderer/data/hooks/useCache', async () => {
  const { MockUseCache } = await import('@test-mocks/renderer/useCache')

  return {
    ...MockUseCache,
    useCache: () => [false],
    useSharedCache: () => [undefined, vi.fn()],
    useSharedCacheValue: () => undefined,
    usePersistCache: () => [undefined, vi.fn()]
  }
})

const ipcMocks = vi.hoisted(() => ({
  request: vi.fn(),
  on: vi.fn(() => () => {})
}))

const modelFixtures = vi.hoisted(() => ({
  configuredPlanExecutionModel: undefined as
    | {
        id: string
        name: string
        providerId: string
        isEnabled: boolean
        capabilities: string[]
        endpointTypes?: string[]
      }
    | undefined
}))

const cloudAvailability = vi.hoisted(() => ({
  // Module-level vi.fn: a fresh predicate per render would rebuild the composer's handoff model and
  // mask the wiring this file exists to pin.
  isModelHidden: vi.fn<(model: { id: string; providerId: string }, includeAgentOnlyModels: boolean) => boolean>(
    () => false
  ),
  isModelUnavailable: vi.fn<(model: { id: string }) => boolean>(() => false)
}))

vi.mock('@renderer/hooks/useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelHidden: cloudAvailability.isModelHidden,
    isModelUnavailable: cloudAvailability.isModelUnavailable,
    getModelDescription: () => undefined
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (uniqueModelId: unknown) => ({
    model: uniqueModelId ? modelFixtures.configuredPlanExecutionModel : undefined
  })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [{ id: 'cherryai', name: 'Cherry AI' }] })
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({
    agent: { id: 'agent-1', model: 'cherryai::claude-opus-5' },
    isLoading: false
  }),
  useAgents: () => ({
    agents: [{ id: 'agent-1', model: 'cherryai::claude-opus-5' }],
    isLoading: false
  }),
  useUpdateAgent: () => ({ updateModel: vi.fn(async () => ({ id: 'agent-1' })) })
}))

vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({
  useAgentWorkspaceWarning: () => undefined
}))

const activeSessionMocks = vi.hoisted(() => ({
  result: {
    activeSessionId: 'session-1',
    session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
    isLoading: false,
    setActiveSessionId: vi.fn()
  }
}))

const agentSessionPartsMocks = vi.hoisted(() => ({
  result: {
    messages: [] as any[],
    persistedPartsByMessageId: {} as Record<string, any[]>,
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    refresh: vi.fn(),
    seedReservedMessages: vi.fn(),
    replaceMessageTail: vi.fn(),
    deleteMessage: vi.fn()
  }
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useActiveSession: () => activeSessionMocks.result,
  useUpdateSession: () => ({ updateSession: vi.fn() })
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => agentSessionPartsMocks.result
}))

const chatHistoryMocks = vi.hoisted(() => ({
  result: {
    activeExecutions: [] as unknown[],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => chatHistoryMocks.result
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({
    overlay: {},
    liveAssistants: [],
    reset: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicOverlayHandoffOnTerminal: () => {}
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentFileWorkspaceKey: (workspaceId?: string | null, workspacePath?: string) =>
    `${workspaceId ?? ''}\0${workspacePath ?? ''}`,
  buildAgentSessionTopicId: (sessionId: string) => `agent-session:${sessionId}`
}))

// Module-level t with stable identity so composer callbacks are not rebuilt every render.
const stableT = (key: string, options?: Record<string, unknown>) => {
  const value = key
  if (!options) return value
  return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? ''))
}

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: stableT })
}))

const PLAN_EXECUTION_MODEL_ID = 'cherryai::claude-opus-5'

function planApprovalMessage() {
  return {
    id: 'message-1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-ExitPlanMode',
        toolName: 'ExitPlanMode',
        toolCallId: 'plan-call-1',
        state: 'approval-requested',
        input: { plan: '# Plan' },
        approval: { id: 'approval-plan-1' }
      }
    ]
  }
}

function renderAgentChat() {
  const bootstrap: ComponentProps<typeof AgentChat>['conversationBootstrap'] = {
    session: activeSessionMocks.result.session as ComponentProps<typeof AgentChat>['conversationBootstrap']['session'],
    sessionLoading: false,
    sessionSource: 'query',
    resources: {
      agent: { id: 'agent-1', model: PLAN_EXECUTION_MODEL_ID } as any,
      agentLoading: false,
      model: { id: PLAN_EXECUTION_MODEL_ID, name: 'Claude Opus 5' } as any,
      modelLoading: false
    }
  }
  return render(<AgentChat conversationBootstrap={bootstrap} />)
}

function respondApprovalPayload(): Record<string, unknown> | undefined {
  return ipcMocks.request.mock.calls.find(([route]) => route === 'ai.tool.respond_approval')?.[1] as
    | Record<string, unknown>
    | undefined
}

describe('AgentChat plan-execution handoff gates', () => {
  beforeEach(() => {
    cloudAvailability.isModelHidden.mockReset().mockReturnValue(false)
    cloudAvailability.isModelUnavailable.mockReset().mockReturnValue(false)
    modelFixtures.configuredPlanExecutionModel = {
      id: PLAN_EXECUTION_MODEL_ID,
      name: 'Claude Opus 5',
      providerId: 'cherryai',
      isEnabled: true,
      capabilities: []
    }
    ipcMocks.request.mockReset().mockResolvedValue({ ok: true, data: { ok: true } })
    ipcMocks.on.mockClear()
    chatHistoryMocks.result = {
      activeExecutions: [],
      sendMessage: vi.fn(),
      stop: vi.fn(async () => {}),
      setMessages: vi.fn()
    }
    MockUsePreferenceUtils.setPreferenceValue('chat.plan_execution.model_id', PLAN_EXECUTION_MODEL_ID)
    agentSessionPartsMocks.result = {
      messages: [planApprovalMessage()],
      persistedPartsByMessageId: {},
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: vi.fn(),
      seedReservedMessages: vi.fn(),
      replaceMessageTail: vi.fn(),
      deleteMessage: vi.fn()
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          toolApproval: {
            respond: vi.fn()
          }
        },
        file: {
          getMetadata: vi.fn().mockResolvedValue({ kind: 'file', size: 1024 })
        },
        ipcApi: {
          request: ipcMocks.request,
          on: ipcMocks.on
        }
      }
    })
  })

  it('does not promise a Cloud model the availability gate rejects and keeps the current-model fallback', async () => {
    cloudAvailability.isModelUnavailable.mockImplementation((model) => model.id === PLAN_EXECUTION_MODEL_ID)

    renderAgentChat()

    const notice = await screen.findByTestId('plan-execution-model')
    expect(notice).toHaveTextContent('agent.toolPermission.executionModel.unavailable')
    expect(notice).not.toHaveTextContent('agent.toolPermission.executionModel.notice')

    fireEvent.click(screen.getByRole('button', { name: /agent\.toolPermission\.button\.allow/ }))
    await waitFor(() =>
      expect(ipcMocks.request).toHaveBeenCalledWith(
        'ai.tool.respond_approval',
        expect.objectContaining({ approvalId: 'approval-plan-1', approved: true })
      )
    )
    // The card could not promise the switch, so the approval must not carry a handoff: the plan
    // keeps executing on the agent's current model.
    expect(respondApprovalPayload()?.executionModelId).toBeUndefined()
  })

  it('does not promise a Cloud model that lost entitlement and keeps the current-model fallback', async () => {
    // Entitlement loss alone: the agent picker hides the model while its quota is untouched, so a
    // quota-only gate would still promise this switch — and Cloud would refuse it after the
    // renderer had switched the agent and stopped the working turn.
    cloudAvailability.isModelHidden.mockImplementation((model) => model.id === PLAN_EXECUTION_MODEL_ID)

    renderAgentChat()

    const notice = await screen.findByTestId('plan-execution-model')
    expect(notice).toHaveTextContent('agent.toolPermission.executionModel.unavailable')
    expect(notice).not.toHaveTextContent('agent.toolPermission.executionModel.notice')

    fireEvent.click(screen.getByRole('button', { name: /agent\.toolPermission\.button\.allow/ }))
    await waitFor(() =>
      expect(ipcMocks.request).toHaveBeenCalledWith(
        'ai.tool.respond_approval',
        expect.objectContaining({ approvalId: 'approval-plan-1', approved: true })
      )
    )
    expect(respondApprovalPayload()?.executionModelId).toBeUndefined()
  })

  it('still promises an agent-only Cloud model that non-agent pickers hide', async () => {
    // Agent-scope visibility decides: an agent-only model sits in the server's `agent` list but
    // not `general`, so gating on the general list would block a handoff the agent may run.
    cloudAvailability.isModelHidden.mockImplementation((_model, includeAgentOnlyModels) => !includeAgentOnlyModels)

    renderAgentChat()

    const notice = await screen.findByTestId('plan-execution-model')
    expect(notice).toHaveTextContent('agent.toolPermission.executionModel.notice')

    fireEvent.click(screen.getByRole('button', { name: /agent\.toolPermission\.button\.allow/ }))
    await waitFor(() =>
      expect(ipcMocks.request).toHaveBeenCalledWith(
        'ai.tool.respond_approval',
        expect.objectContaining({ approvalId: 'approval-plan-1', approved: true })
      )
    )
    expect(respondApprovalPayload()?.executionModelId).toBe(PLAN_EXECUTION_MODEL_ID)
  })

  it('still promises an available execution model and hands it off on approval', async () => {
    renderAgentChat()

    const notice = await screen.findByTestId('plan-execution-model')
    expect(notice).toHaveTextContent('agent.toolPermission.executionModel.notice')

    fireEvent.click(screen.getByRole('button', { name: /agent\.toolPermission\.button\.allow/ }))
    await waitFor(() =>
      expect(ipcMocks.request).toHaveBeenCalledWith(
        'ai.tool.respond_approval',
        expect.objectContaining({ approvalId: 'approval-plan-1', approved: true })
      )
    )
    expect(respondApprovalPayload()?.executionModelId).toBe(PLAN_EXECUTION_MODEL_ID)
  })
})
