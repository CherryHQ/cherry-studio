import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as MotionReact from 'motion/react'
import type { ComponentProps, PropsWithChildren, ReactElement, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

const workspaceWarningMock = vi.hoisted(() => ({ value: undefined as string | undefined }))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  NormalTooltip: ({ children }: PropsWithChildren) => children,
  Tooltip: ({ children }: PropsWithChildren) => children
}))

vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: ({ topBar, center }: { topBar?: ReactNode; center?: ReactNode }) => (
    <div>
      <div>{topBar}</div>
      <div>{center}</div>
    </div>
  )
}))

vi.mock('@renderer/components/chat/shell/ConversationCenterState', () => ({
  default: ({ state }: { state: string }) => <div data-testid="conversation-center-state" data-state={state} />
}))

vi.mock('@renderer/components/chat/primitives', async (importActual) => ({
  ...(await importActual<typeof ChatPrimitives>()),
  EmptyState: () => <div />,
  LoadingState: () => <div />
}))

vi.mock('@renderer/components/chat/shell/RightPaneHost', () => ({
  RightPaneHost: ({ children }: PropsWithChildren) => <section>{children}</section>,
  PersistentRightPaneHost: ({ children }: PropsWithChildren) => <section>{children}</section>
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', () => ({
  ARTIFACT_PANE_WIDTH: 460,
  normalizeArtifactPaneFilePath: (_workspacePath: string, rawPath: string) => rawPath,
  resolveArtifactPaneFileSelection: () => null,
  ArtifactPaneView: () => <div />,
  default: () => <div />
}))

vi.mock('@renderer/components/composer/ComposerContext', () => ({
  ComposerContextProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/composer/ComposerCore', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>
}))

vi.mock('@renderer/components/composer/useToolApprovalComposerOverrides', () => ({
  useToolApprovalComposerOverrides: () => ({})
}))

vi.mock('@renderer/components/composer/ComposerDockTransitionFrame', () => ({
  default: ({ main, composer }: { main: ReactNode; composer: ReactNode }) => (
    <div>
      {main}
      {composer}
    </div>
  )
}))

vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: () => <div />,
  AgentHomeComposer: () => <div />,
  MissingAgentHomeComposer: () => <div />
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
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
    useSharedCache: () => [null, vi.fn()],
    useSharedCacheValue: () => undefined,
    usePersistCache: () => [undefined, vi.fn()]
  }
})

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => ['none', vi.fn()]
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: { id: 'agent-1' }, isLoading: false }),
  useAgents: () => ({ agents: [{ id: 'agent-1' }], isLoading: false }),
  useUpdateAgent: () => ({ updateModel: vi.fn() })
}))

vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({
  useAgentWorkspaceWarning: () => workspaceWarningMock.value
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn()
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useActiveSession: () => ({ activeSessionId: 'session-1', isLoading: false, setActiveSessionId: vi.fn() }),
  useUpdateSession: () => ({ updateSession: vi.fn() })
}))

const agentSessionPartsMocks = vi.hoisted(() => ({
  result: {
    messages: [] as any[],
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    refresh: vi.fn(),
    deleteMessage: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => agentSessionPartsMocks.result
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({ activeExecutions: [], sendMessage: vi.fn(), stop: vi.fn(), setMessages: vi.fn() })
}))

vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({ overlay: {}, liveAssistants: [], disposeOverlay: vi.fn(), reset: vi.fn() })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicOverlayHandoffOnTerminal: () => {}
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/AgentChatNavbar', () => ({
  AgentChatNavbar: ({ conversationControls }: { conversationControls?: ReactNode }) => (
    <div data-testid="agent-chat-navbar">{conversationControls}</div>
  )
}))

vi.mock('../AgentChatMain', () => ({ default: () => <div /> }))
vi.mock('../AgentComposerSlot', () => ({ default: () => <div /> }))

vi.mock('@renderer/components/ModelSelector', () => ({
  ModelSelector: ({ trigger }: { trigger: ReactElement }) => trigger
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({ default: () => <span /> }))

// The read-only branch of the workspace control renders `OpenExternalAppButton` instead of the
// selector — the two stubs below are what tells the locked state apart from the changeable one.
vi.mock('@renderer/components/chat/panes/OpenExternalAppButton', () => ({
  default: ({ menuTrigger }: { menuTrigger: ReactElement }) => (
    <div data-testid="workspace-open-external-only">{menuTrigger}</div>
  )
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({ trigger }: { trigger: ReactElement }) => trigger,
  WorkspaceSelector: ({ trigger, onChange }: { trigger: ReactElement; onChange: (id: string | null) => void }) => (
    <div data-testid="workspace-selector">
      {trigger}
      <button type="button" onClick={() => onChange('workspace-relocated')}>
        pick-relocated-workspace
      </button>
    </div>
  )
}))

describe('AgentChat workspace control', () => {
  const conversationBootstrap = (): ComponentProps<typeof AgentChat>['conversationBootstrap'] => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      workspace: { id: 'workspace-1', type: 'user', name: 'my-project', path: '/tmp/my-project' }
    } as ComponentProps<typeof AgentChat>['conversationBootstrap']['session'],
    sessionLoading: false,
    sessionSource: 'query',
    resources: {
      agent: { id: 'agent-1', name: 'Agent' } as any,
      agentLoading: false,
      model: { id: 'provider::model-1', name: 'Model 1' } as any,
      modelLoading: false
    }
  })

  beforeEach(() => {
    workspaceWarningMock.value = undefined
    agentSessionPartsMocks.result = {
      messages: [{ id: 'message-1', role: 'user', parts: [] }],
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: vi.fn(),
      deleteMessage: vi.fn()
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ai: { toolApproval: { respond: vi.fn() } }, file: { getMetadata: vi.fn() } }
    })
  })

  it('lets a started conversation relocate an unreachable workspace', async () => {
    workspaceWarningMock.value = 'agent.session.workspace_status.inaccessible'
    const onSessionWorkspaceChange = vi.fn()

    render(
      <AgentChat conversationBootstrap={conversationBootstrap()} onSessionWorkspaceChange={onSessionWorkspaceChange} />
    )

    await userEvent.click(screen.getByRole('button', { name: 'pick-relocated-workspace' }))

    expect(onSessionWorkspaceChange).toHaveBeenCalledWith('workspace-relocated')
  })

  it('keeps the workspace of a started conversation that is still reachable', () => {
    render(<AgentChat conversationBootstrap={conversationBootstrap()} onSessionWorkspaceChange={vi.fn()} />)

    expect(screen.getByTestId('workspace-open-external-only')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-selector')).not.toBeInTheDocument()
  })
})
