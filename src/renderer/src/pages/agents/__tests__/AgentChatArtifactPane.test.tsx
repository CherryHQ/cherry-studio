import { fireEvent, render, screen, within } from '@testing-library/react'
import type * as MotionReact from 'motion/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { useState } from 'react'
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
      <div data-testid="agent-top-bar">{topBar}</div>
      <div data-testid="shell-pane">{pane}</div>
      <div data-testid="agent-side-panel">{sidePanel}</div>
      <div>{centerContent ?? main}</div>
      <div>{bottomComposer}</div>
      <div data-testid="chat-center-overlay">{centerOverlay}</div>
      <div>{overlay}</div>
    </div>
  ),
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      {title}
      {description}
    </div>
  ),
  LoadingState: () => <div data-testid="loading-state" />,
  RightPaneHost: ({
    children,
    open,
    width,
    resizable,
    minWidth,
    defaultWidth,
    maxWidth,
    cacheKey,
    className,
    onOpenAnimationComplete
  }: PropsWithChildren<{
    open?: boolean
    width?: string | number
    resizable?: boolean
    minWidth?: number
    defaultWidth?: number
    maxWidth?: number
    cacheKey?: string
    className?: string
    onOpenAnimationComplete?: () => void
  }>) => (
    <section
      data-testid="artifact-right-pane"
      data-open={String(Boolean(open))}
      data-width={String(width)}
      data-resizable={String(Boolean(resizable))}
      data-min-width={String(minWidth)}
      data-default-width={String(defaultWidth)}
      data-max-width={String(maxWidth)}
      data-cache-key={cacheKey}
      data-class-name={className ?? ''}>
      <button type="button" aria-label="complete artifact pane animation" onClick={onOpenAnimationComplete} />
      {open ? children : null}
    </section>
  )
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', () => ({
  ARTIFACT_PANE_WIDTH: 460,
  default: ({
    workspacePath,
    pdfLayoutPending,
    selectedFile,
    viewMode,
    onSelectedFileChange,
    onViewModeChange,
    onToggleMaximized,
    pdfLayoutRefreshKey
  }: {
    workspacePath?: string
    pdfLayoutPending?: boolean
    selectedFile?: string | null
    viewMode?: 'preview' | 'code'
    onSelectedFileChange?: (file: string | null) => void
    onViewModeChange?: (mode: 'preview' | 'code') => void
    onToggleMaximized?: () => void
    pdfLayoutRefreshKey?: number
  }) => (
    <div
      data-testid="artifact-pane"
      data-workspace-path={workspacePath ?? ''}
      data-selected-file={selectedFile ?? ''}
      data-view-mode={viewMode ?? ''}
      data-pdf-layout-pending={String(Boolean(pdfLayoutPending))}
      data-pdf-layout-refresh-key={String(pdfLayoutRefreshKey ?? 0)}>
      <button type="button" onClick={() => onSelectedFileChange?.('README.md')}>
        select artifact file
      </button>
      <button type="button" onClick={() => onViewModeChange?.(viewMode === 'code' ? 'preview' : 'code')}>
        toggle artifact view mode
      </button>
      {onToggleMaximized && (
        <button type="button" onClick={onToggleMaximized}>
          maximize artifact pane
        </button>
      )}
    </div>
  )
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
  default: ({
    placement,
    main,
    composer,
    mainVisible,
    composerElevated
  }: {
    placement: string
    main: ReactNode
    composer: ReactNode
    mainVisible?: boolean
    composerElevated?: boolean
  }) => (
    <div
      data-testid="composer-dock-frame"
      data-placement={placement}
      data-main-visible={String(Boolean(mainVisible))}
      data-composer-elevated={String(Boolean(composerElevated))}>
      {main}
      {composer}
    </div>
  )
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

// Keep `motion` real; collapse AnimatePresence so exit animations don't retain
// a stale maximized overlay during the test's synchronous assertions.
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
  useCache: () => [false]
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
    agents: [
      { id: 'agent-1', model: 'provider:model-1' },
      { id: 'agent-2', model: 'provider:model-2' }
    ],
    isLoading: false
  })
}))

const activeSessionMocks = vi.hoisted(() => ({
  result: {
    activeSessionId: 'session-1',
    session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
    isLoading: false,
    sessionSource: 'query',
    setActiveSessionId: vi.fn()
  } as {
    activeSessionId: string | null
    session: { id: string; agentId: string | null; workspace: { path: string } | null } | undefined
    isLoading: boolean
    sessionSource?: 'query' | 'pending' | 'none'
    setActiveSessionId: ReturnType<typeof vi.fn>
  }
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn()
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useActiveSession: (options?: { pendingSession?: { id: string } | null }) => {
    const result = activeSessionMocks.result
    if (result.session) return { ...result, sessionSource: result.sessionSource ?? 'query' }
    if (options?.pendingSession?.id && result.activeSessionId === options.pendingSession.id) {
      return {
        ...result,
        session: options.pendingSession,
        sessionSource: 'pending',
        isLoading: false
      }
    }
    return { ...result, sessionSource: result.sessionSource ?? 'none' }
  }
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => ({
    messages: [],
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    refresh: vi.fn(),
    seedReservedMessages: vi.fn(),
    deleteMessage: vi.fn()
  })
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
  default: ({ tools }: { tools?: ReactNode }) => <div>{tools}</div>
}))

vi.mock('@renderer/components/chat/composer/variants/AgentComposer', () => ({
  default: ({ sendDisabled }: { sendDisabled?: boolean }) => (
    <div data-testid="agent-composer" data-send-disabled={String(Boolean(sendDisabled))} />
  ),
  AgentHomeComposer: () => <div data-testid="agent-home-composer" />
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: ({ sessionId, openAgentToolFlow }: { sessionId: string; openAgentToolFlow?: (input: any) => void }) => (
    <div data-testid="agent-messages" data-session-id={sessionId}>
      <button
        type="button"
        onClick={() =>
          openAgentToolFlow?.({
            toolCallId: 'agent-a',
            toolName: 'Agent',
            title: 'cache-usage.md'
          })
        }>
        open flow a
      </button>
      <button
        type="button"
        onClick={() =>
          openAgentToolFlow?.({
            toolCallId: 'agent-b',
            toolName: 'Agent',
            title: 'renderer audit'
          })
        }>
        open flow b
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="citations-panel" data-open={String(open)} />
}))

vi.mock('../../home/Inputbar/components/PinnedTodoPanel', () => ({
  PinnedTodoPanel: () => <div data-testid="pinned-todo-panel" />
}))

describe('AgentChat artifact pane', () => {
  beforeEach(() => {
    activeSessionMocks.result = {
      activeSessionId: 'session-1',
      session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
      isLoading: false,
      setActiveSessionId: vi.fn()
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          toolApproval: {
            respond: vi.fn()
          }
        }
      }
    })
  })

  it('opens and closes the artifact pane without replacing the existing chat shell pane', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    expect(screen.getByTestId('chat-app-shell').parentElement).toHaveClass('h-[calc(100vh-var(--navbar-height)-6px)]')
    expect(screen.getByTestId('chat-app-shell')).toHaveAttribute('data-pane-open', 'true')
    expect(screen.getByTestId('chat-app-shell')).toHaveAttribute('data-pane-position', 'left')
    expect(screen.getByTestId('session-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('pinned-todo-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'false')

    const toggle = screen.getByRole('button', { name: 'agent.right_pane.files_toggle' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-width', '460')
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-resizable', 'true')
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-min-width', '360')
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-default-width', '460')
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-max-width', '720')
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-cache-key', 'ui.chat.artifact_pane.width')
    expect(screen.getByTestId('artifact-right-pane').getAttribute('data-class-name')).not.toContain('p-2')
    expect(screen.getByRole('button', { name: /agent\.right_pane\.tabs\.files/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agent\.right_pane\.tabs\.flow/ })).toBeNull()
    expect(screen.getByRole('button', { name: /agent\.right_pane\.tabs\.status/ })).toBeInTheDocument()
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-workspace-path', '/tmp/workspace')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(toggle)

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'false')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('session-pane')).toBeInTheDocument()
  })

  it('maximizes into the chat-area overlay, unmounting the docked host', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.files_toggle' }))
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    // The docked host unmounts entirely while maximized (snap, no width animation).
    expect(screen.queryByTestId('artifact-right-pane')).toBeNull()
    // The overlay fills the chat area; the composer dock layer lifts above it.
    expect(screen.getByTestId('chat-center-overlay').firstElementChild).toHaveClass(
      'absolute',
      'inset-0',
      'z-40',
      'bg-background'
    )
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-composer-elevated', 'true')
    expect(screen.getByTestId('agent-top-bar')).toBeInTheDocument()
    expect(screen.getByTestId('chat-center-overlay')).toContainElement(screen.getByTestId('artifact-pane'))
    expect(screen.getByRole('button', { name: 'common.minimize' })).toBeInTheDocument()
    expect(screen.getByTestId('agent-composer')).toBeInTheDocument()
  })

  it('keeps the selected artifact file when maximizing and restoring the pane', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.files_toggle' }))
    fireEvent.click(screen.getByRole('button', { name: 'select artifact file' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('chat-center-overlay')).toContainElement(screen.getByTestId('artifact-pane'))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')
  })

  it('refreshes PDF layout state after the docked artifact pane finishes opening', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.files_toggle' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-pdf-layout-pending', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-pdf-layout-refresh-key', '0')

    fireEvent.click(screen.getByRole('button', { name: 'complete artifact pane animation' }))

    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-pdf-layout-pending', 'false')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-pdf-layout-refresh-key', '1')
  })

  it('does not render a second maximize control inside the artifact files panel', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.files_toggle' }))

    expect(screen.getByRole('button', { name: 'common.maximize' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'maximize artifact pane' })).not.toBeInTheDocument()
  })

  it('keeps the artifact view mode when maximizing and restoring the pane', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.files_toggle' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'preview')

    fireEvent.click(screen.getByRole('button', { name: 'toggle artifact view mode' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'code')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    expect(screen.queryByTestId('artifact-right-pane')).toBeNull()
    expect(screen.getByTestId('chat-center-overlay')).toContainElement(screen.getByTestId('artifact-pane'))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'code')

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'code')
  })

  it('resets the artifact view mode when the workspace changes', () => {
    const { rerender } = render(
      <AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.files_toggle' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle artifact view mode' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'code')

    activeSessionMocks.result = {
      ...activeSessionMocks.result,
      activeSessionId: 'session-2',
      session: { id: 'session-2', agentId: 'agent-1', workspace: { path: '/tmp/other-workspace' } }
    }
    rerender(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-workspace-path', '/tmp/other-workspace')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'preview')
  })

  it('renders the temporary session composer in home placement', () => {
    activeSessionMocks.result = {
      activeSessionId: null,
      session: undefined,
      isLoading: false,
      setActiveSessionId: vi.fn()
    }

    render(
      <AgentChat
        temporaryConversation={
          {
            type: 'agent',
            id: 'temp-session-1',
            sessionId: 'temp-session-1',
            topicId: 'agent-session:temp-session-1',
            agentId: 'agent-1',
            workspace: { path: '/tmp/workspace' },
            name: 'Temp Session',
            session: { id: 'temp-session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } }
          } as any
        }
      />
    )

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-main-visible', 'false')
    expect(screen.getByTestId('agent-home-composer')).toBeInTheDocument()
  })

  it('opens one right-pane tab per selected subagent flow', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'open flow a' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: /cache-usage\.md/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agent\.right_pane\.tabs\.flow/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'open flow b' }))

    expect(screen.getByRole('button', { name: /cache-usage\.md/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /renderer audit/ })).toBeInTheDocument()
    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
  })

  it('closes a subagent flow tab from its hover close button', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'open flow a' }))
    fireEvent.click(screen.getByRole('button', { name: 'open flow b' }))
    expect(screen.getByRole('button', { name: /cache-usage\.md/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /renderer audit/ })).toBeInTheDocument()

    const flowBTab = screen.getByRole('button', { name: /renderer audit/ })
    fireEvent.click(within(flowBTab.parentElement as HTMLElement).getByRole('button', { name: 'common.close' }))

    expect(screen.queryByRole('button', { name: /renderer audit/ })).toBeNull()
    expect(screen.getByRole('button', { name: /cache-usage\.md/ })).toBeInTheDocument()
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
  })

  it('does not render stale session content while a selected session reloads', () => {
    function SessionPane() {
      const [count, setCount] = useState(0)

      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          pane count {count}
        </button>
      )
    }

    const { rerender } = render(<AgentChat pane={<SessionPane />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'pane count 0' }))
    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()

    activeSessionMocks.result = {
      activeSessionId: 'session-2',
      session: undefined,
      isLoading: true,
      setActiveSessionId: vi.fn()
    }
    rerender(<AgentChat pane={<SessionPane />} paneOpen={true} panePosition="left" />)

    expect(screen.getByRole('button', { name: /pane count/ })).toBeInTheDocument()
    expect(screen.queryByTestId('agent-messages')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-composer')).not.toBeInTheDocument()
  })

  it('shows the persisted temporary session while the active session query catches up', () => {
    const { rerender } = render(
      <AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />
    )

    activeSessionMocks.result = {
      activeSessionId: 'temp-session-1',
      session: undefined,
      isLoading: true,
      setActiveSessionId: vi.fn()
    }
    rerender(
      <AgentChat
        pane={<aside data-testid="session-pane" />}
        paneOpen={true}
        panePosition="left"
        pendingSession={{ id: 'temp-session-1', agentId: 'agent-1', workspace: { path: '/tmp/temp-workspace' } } as any}
      />
    )

    expect(screen.getByTestId('agent-messages')).toHaveAttribute('data-session-id', 'temp-session-1')
    expect(screen.getByTestId('agent-composer')).toHaveAttribute('data-send-disabled', 'false')
  })

  it('shows history without composer for an unlinked session', () => {
    activeSessionMocks.result = {
      activeSessionId: 'session-unlinked',
      session: { id: 'session-unlinked', agentId: null, workspace: { path: '/tmp/workspace' } },
      isLoading: false,
      setActiveSessionId: vi.fn()
    }

    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-messages')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-composer')).not.toBeInTheDocument()
  })
})
