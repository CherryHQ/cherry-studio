import { render, waitFor } from '@testing-library/react'
import type * as MotionReact from 'motion/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal()),
  Badge: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
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

vi.mock('@renderer/components/chat', () => ({
  ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 460,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH: 720,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH: 360,
  ChatAppShell: ({
    pane,
    paneOpen,
    panePosition,
    topBar,
    sidePanel,
    main,
    centerContent,
    bottomComposer,
    overlay,
    centerOverlay
  }: {
    pane?: ReactNode
    paneOpen?: boolean
    panePosition?: string
    topBar?: ReactNode
    sidePanel?: ReactNode
    main?: ReactNode
    centerContent?: ReactNode
    bottomComposer?: ReactNode
    overlay?: ReactNode
    centerOverlay?: ReactNode
  }) => (
    <div data-testid="chat-app-shell" data-pane-open={String(Boolean(paneOpen))} data-pane-position={panePosition}>
      <div>{topBar}</div>
      <div>{pane}</div>
      <div>{sidePanel}</div>
      <div>{centerContent ?? main}</div>
      <div>{bottomComposer}</div>
      <div>{centerOverlay}</div>
      <div>{overlay}</div>
    </div>
  ),
  ConversationShell: ({
    pane,
    paneOpen,
    panePosition,
    topBar,
    topRightTool,
    sidePanel,
    center,
    overlay,
    centerOverlay,
    rightPane
  }: {
    pane?: ReactNode
    paneOpen?: boolean
    panePosition?: string
    topBar?: ReactNode
    topRightTool?: ReactNode
    sidePanel?: ReactNode
    center?: ReactNode
    overlay?: ReactNode
    centerOverlay?: ReactNode
    rightPane?: ReactNode
  }) => (
    <div data-testid="chat-app-shell" data-pane-open={String(Boolean(paneOpen))} data-pane-position={panePosition}>
      <div>{topBar}</div>
      <div>{topRightTool}</div>
      <div>{pane}</div>
      <div>{sidePanel}</div>
      <div>{center}</div>
      <div>{centerOverlay}</div>
      <div>{overlay}</div>
      {rightPane}
    </div>
  ),
  ConversationCenterState: ({ state }: { state: string }) => (
    <div data-testid="conversation-center-state" data-state={state} />
  ),
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div>
      {title}
      {description}
    </div>
  ),
  LoadingState: () => <div />,
  RightPaneHost: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (
    <section>{open ? children : null}</section>
  )
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', () => ({
  ARTIFACT_PANE_WIDTH: 460,
  ArtifactFilePreview: () => <div />,
  normalizeArtifactPaneFilePath: (workspacePath: string, rawPath: string) =>
    rawPath.startsWith(`${workspacePath}/`) ? rawPath.slice(workspacePath.length + 1) : rawPath,
  resolveArtifactPaneFileSelection: (workspacePath: string | undefined, rawPath: string) =>
    workspacePath ? { workspacePath, filePath: rawPath.replace(`${workspacePath}/`, '') } : null,
  default: () => <div />
}))

vi.mock('@renderer/components/chat/composer/ComposerContext', () => ({
  ComposerContextProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/chat/composer/ComposerCore', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>
}))

vi.mock('@renderer/components/chat/composer/useToolApprovalComposerOverrides', () => ({
  useToolApprovalComposerOverrides: () => ({})
}))

vi.mock('@renderer/components/chat/composer/ComposerDockTransitionFrame', () => ({
  default: ({ main, composer }: { main: ReactNode; composer: ReactNode }) => (
    <div>
      {main}
      {composer}
    </div>
  )
}))

vi.mock('@renderer/components/chat/composer/variants/AgentComposer', () => ({
  default: () => <div />,
  AgentHomeComposer: () => <div />
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof MotionReact>()),
  AnimatePresence: ({ children }: PropsWithChildren) => <>{children}</>,
  useReducedMotion: () => false
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false],
  useSharedCache: () => [null, vi.fn()],
  usePersistCache: () => [undefined, vi.fn()]
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => [key === 'chat.narrow_mode' ? false : 'none', vi.fn()]
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({
    agent: { id: 'agent-1', model: 'provider:model-1' },
    isLoading: false
  }),
  useAgents: () => ({
    agents: [{ id: 'agent-1', model: 'provider:model-1' }],
    isLoading: false
  })
}))

const activeSessionMocks = vi.hoisted(() => ({
  result: {
    activeSessionId: 'session-1',
    session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
    isLoading: false,
    setActiveSessionId: vi.fn()
  } as {
    activeSessionId: string | null
    session: { id: string; agentId: string | null; workspace: { path: string } | null } | undefined
    isLoading: boolean
    setActiveSessionId: ReturnType<typeof vi.fn>
  }
}))

const agentSessionPartsMocks = vi.hoisted(() => ({
  loadOlder: vi.fn(),
  locateAgentMessageInList: vi.fn(),
  result: {
    messages: [] as any[],
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    refresh: vi.fn(),
    deleteMessage: vi.fn()
  }
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn()
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useActiveSession: () => activeSessionMocks.result
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => agentSessionPartsMocks.result
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({
    activeExecutions: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn()
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

vi.mock('../messages/agentMessageListAdapter', () => ({
  locateAgentMessageInList: (...args: unknown[]) => agentSessionPartsMocks.locateAgentMessageInList(...args)
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/AgentChatNavbar', () => ({
  default: ({ tools }: { tools?: ReactNode }) => <div>{tools}</div>
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: ({ sessionId }: { sessionId: string }) => <div data-testid="agent-messages" data-session-id={sessionId} />
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="citations-panel" data-open={String(open)} />
}))

describe('AgentChat locate pending message', () => {
  const activeSessionProps = (): Pick<
    ComponentProps<typeof AgentChat>,
    'activeSession' | 'activeSessionLoading' | 'activeSessionSource'
  > => ({
    activeSession: activeSessionMocks.result.session as ComponentProps<typeof AgentChat>['activeSession'],
    activeSessionLoading: activeSessionMocks.result.isLoading,
    activeSessionSource: activeSessionMocks.result.session ? 'query' : 'none'
  })

  beforeEach(() => {
    activeSessionMocks.result = {
      activeSessionId: 'session-1',
      session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
      isLoading: false,
      setActiveSessionId: vi.fn()
    }
    agentSessionPartsMocks.loadOlder = vi.fn()
    agentSessionPartsMocks.locateAgentMessageInList = vi.fn()
    agentSessionPartsMocks.result = {
      messages: [],
      isLoading: false,
      hasOlder: false,
      loadOlder: agentSessionPartsMocks.loadOlder,
      refresh: vi.fn(),
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
          isTextFile: vi.fn().mockResolvedValue(true),
          getMetadata: vi.fn().mockResolvedValue({ kind: 'file', size: 1024 })
        }
      }
    })
  })

  it('keeps pending locate requests while session history is still loading', () => {
    const onLocateMessageHandled = vi.fn()
    agentSessionPartsMocks.result = {
      ...agentSessionPartsMocks.result,
      messages: [{ id: 'session-message-old', role: 'user', parts: [] }],
      isLoading: true,
      hasOlder: true,
      loadOlder: agentSessionPartsMocks.loadOlder
    }

    render(
      <AgentChat
        {...activeSessionProps()}
        pane={<aside data-testid="session-pane" />}
        paneOpen={true}
        panePosition="left"
        locateMessageId="session-message-target"
        onLocateMessageHandled={onLocateMessageHandled}
      />
    )

    expect(agentSessionPartsMocks.loadOlder).not.toHaveBeenCalled()
    expect(agentSessionPartsMocks.locateAgentMessageInList).not.toHaveBeenCalled()
    expect(onLocateMessageHandled).not.toHaveBeenCalled()
  })

  it('loads older session history for pending locate and clears it only after the target appears', async () => {
    const onLocateMessageHandled = vi.fn()
    agentSessionPartsMocks.result = {
      ...agentSessionPartsMocks.result,
      messages: [{ id: 'session-message-old', role: 'user', parts: [] }],
      isLoading: false,
      hasOlder: true,
      loadOlder: agentSessionPartsMocks.loadOlder
    }

    const { rerender } = render(
      <AgentChat
        {...activeSessionProps()}
        pane={<aside data-testid="session-pane" />}
        paneOpen={true}
        panePosition="left"
        locateMessageId="session-message-target"
        onLocateMessageHandled={onLocateMessageHandled}
      />
    )

    await waitFor(() => expect(agentSessionPartsMocks.loadOlder).toHaveBeenCalledTimes(1))
    expect(onLocateMessageHandled).not.toHaveBeenCalled()

    agentSessionPartsMocks.result = {
      ...agentSessionPartsMocks.result,
      messages: [
        { id: 'session-message-old', role: 'user', parts: [] },
        { id: 'session-message-target', role: 'assistant', parts: [] }
      ],
      isLoading: false,
      hasOlder: false,
      loadOlder: agentSessionPartsMocks.loadOlder
    }
    rerender(
      <AgentChat
        {...activeSessionProps()}
        pane={<aside data-testid="session-pane" />}
        paneOpen={true}
        panePosition="left"
        locateMessageId="session-message-target"
        onLocateMessageHandled={onLocateMessageHandled}
      />
    )

    await waitFor(() => {
      expect(agentSessionPartsMocks.locateAgentMessageInList).toHaveBeenCalledWith(
        'agent-session:session-1',
        'session-message-target',
        true
      )
      expect(onLocateMessageHandled).toHaveBeenCalledTimes(1)
    })
  })
})
