import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as MotionReact from 'motion/react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { useEffect, useState } from 'react'
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
  ConversationCenterState: ({ state }: { state: string }) => (
    <div data-testid="conversation-center-state" data-state={state} />
  ),
  ConversationShell: ({
    pane,
    paneOpen,
    panePosition,
    topBar,
    topRightTool,
    sidePanel,
    center,
    centerClassName,
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
    centerClassName?: string
    overlay?: ReactNode
    centerOverlay?: ReactNode
    rightPane?: ReactNode
  }) => (
    <div data-testid="chat-app-shell" data-pane-open={String(Boolean(paneOpen))} data-pane-position={panePosition}>
      <div data-testid="agent-top-bar">{topBar}</div>
      <div data-testid="agent-top-right-tool">{topRightTool}</div>
      <div data-testid="shell-pane">{pane}</div>
      <div data-testid="agent-side-panel">{sidePanel}</div>
      <div data-testid="agent-center" className={centerClassName}>
        {center}
      </div>
      <div data-testid="chat-center-overlay">{centerOverlay}</div>
      <div>{overlay}</div>
      {rightPane}
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
    className
  }: PropsWithChildren<{
    open?: boolean
    width?: string | number
    resizable?: boolean
    minWidth?: number
    defaultWidth?: number
    maxWidth?: number
    cacheKey?: string
    className?: string
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
      {open ? children : null}
    </section>
  )
}))

vi.mock('@renderer/components/chat/shell/RightPaneHost', () => ({
  ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 460,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH: 720,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH: 360,
  RightPaneHost: ({
    children,
    open,
    width,
    resizable,
    minWidth,
    defaultWidth,
    maxWidth,
    cacheKey,
    className
  }: PropsWithChildren<{
    open?: boolean
    width?: string | number
    resizable?: boolean
    minWidth?: number
    defaultWidth?: number
    maxWidth?: number
    cacheKey?: string
    className?: string
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
      {open ? children : null}
    </section>
  )
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', () => {
  const MockArtifactPane = ({
    workspacePath,
    selectedFile,
    onSelectedFileChange,
    fileTreeOpen,
    onFileTreeOpenChange,
    fileTreeExpandedIds,
    onFileTreeExpandedIdsChange,
    fileTreeSearchKeyword,
    onFileTreeSearchKeywordChange
  }: {
    workspacePath?: string
    selectedFile?: string | null
    onSelectedFileChange?: (file: string | null) => void
    fileTreeOpen?: boolean
    onFileTreeOpenChange?: (open: boolean) => void
    fileTreeExpandedIds?: ReadonlySet<string>
    onFileTreeExpandedIdsChange?: (ids: ReadonlySet<string>) => void
    fileTreeSearchKeyword?: string
    onFileTreeSearchKeywordChange?: (keyword: string) => void
  }) => {
    const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
    const [internalFileTreeOpen, setInternalFileTreeOpen] = useState(false)
    const [internalExpandedIds, setInternalExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
    const [internalFileSearchKeyword, setInternalFileSearchKeyword] = useState('')
    const resolvedFileTreeOpen = fileTreeOpen ?? internalFileTreeOpen
    const resolvedExpandedIds = fileTreeExpandedIds ?? internalExpandedIds
    const resolvedFileSearchKeyword = fileTreeSearchKeyword ?? internalFileSearchKeyword

    useEffect(() => {
      setViewMode('preview')
    }, [workspacePath])

    return (
      <div
        data-testid="artifact-pane"
        data-workspace-path={workspacePath ?? ''}
        data-selected-file={selectedFile ?? ''}
        data-view-mode={viewMode}
        data-file-tree-open={String(resolvedFileTreeOpen)}
        data-expanded-ids={Array.from(resolvedExpandedIds).sort().join(',')}
        data-file-search-keyword={resolvedFileSearchKeyword}>
        <button type="button" onClick={() => onSelectedFileChange?.('README.md')}>
          select artifact file
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !resolvedFileTreeOpen
            if (fileTreeOpen === undefined) setInternalFileTreeOpen(next)
            onFileTreeOpenChange?.(next)
          }}>
          toggle artifact file tree
        </button>
        <button
          type="button"
          onClick={() => {
            const next = new Set(resolvedExpandedIds)
            next.add('src')
            if (fileTreeExpandedIds === undefined) setInternalExpandedIds(next)
            onFileTreeExpandedIdsChange?.(next)
          }}>
          expand src folder
        </button>
        <input
          aria-label="artifact file search"
          value={resolvedFileSearchKeyword}
          onChange={(event) => {
            const next = event.target.value
            if (fileTreeSearchKeyword === undefined) setInternalFileSearchKeyword(next)
            onFileTreeSearchKeywordChange?.(next)
          }}
        />
        <button
          type="button"
          aria-label={viewMode === 'preview' ? 'agent.preview_pane.preview' : 'agent.preview_pane.code'}
          onClick={() => setViewMode((current) => (current === 'preview' ? 'code' : 'preview'))}
        />
      </div>
    )
  }

  return {
    ARTIFACT_PANE_WIDTH: 460,
    ArtifactFilePreview: ({
      workspacePath,
      filePath,
      officeActions
    }: {
      workspacePath?: string
      filePath?: string | null
      officeActions?: ReactNode
    }) => (
      <div
        data-testid="artifact-file-preview"
        data-workspace-path={workspacePath ?? ''}
        data-file-path={filePath ?? ''}>
        {officeActions}
      </div>
    ),
    isOfficeDocumentFile: (filePath: string) => /\.(?:docx?|xlsx?|xlsm|pptx?)$/i.test(filePath),
    normalizeArtifactPaneFilePath: (workspacePath: string, rawPath: string) =>
      rawPath.startsWith(`${workspacePath}/`) ? rawPath.slice(workspacePath.length + 1) : rawPath,
    resolveArtifactPaneFileSelection: (workspacePath: string | undefined, rawPath: string) => {
      if (workspacePath && rawPath.startsWith(`${workspacePath}/`)) {
        return { workspacePath, filePath: rawPath.slice(workspacePath.length + 1) }
      }
      if (rawPath.startsWith('/')) {
        const index = rawPath.lastIndexOf('/')
        return { workspacePath: rawPath.slice(0, index), filePath: rawPath.slice(index + 1) }
      }
      return workspacePath ? { workspacePath, filePath: rawPath } : null
    },
    default: MockArtifactPane
  }
})

vi.mock('@renderer/components/chat/panes/OpenExternalAppButton', () => ({
  default: ({ workdir, filePath }: { workdir: string; filePath?: string | null }) => (
    <button type="button" data-testid="open-external-app-button" data-workdir={workdir} data-file-path={filePath ?? ''}>
      open external app
    </button>
  )
}))

vi.mock('@renderer/components/chat/trace/TracePane', () => ({
  TracePane: ({ payload }: { payload: { topicId: string; traceId: string; modelName?: string } | null }) => (
    <div data-testid="trace-pane" data-topic-id={payload?.topicId} data-trace-id={payload?.traceId} />
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

vi.mock('@renderer/components/chat/composer/ConversationComposerStage', () => ({
  default: ({
    placement,
    main,
    composer,
    homeWelcomeText,
    composerElevated
  }: {
    placement: string
    main: ReactNode
    composer: ReactNode
    homeWelcomeText?: string
    composerElevated?: boolean
  }) => (
    <div
      data-testid="composer-dock-frame"
      data-placement={placement}
      data-main-visible={String(placement === 'docked')}
      data-composer-elevated={String(Boolean(composerElevated))}>
      <div data-testid="composer-dock-home-header">{placement === 'home' ? homeWelcomeText : null}</div>
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
  useCache: () => [false],
  useSharedCache: () => [null, vi.fn()],
  usePersistCache: () => [undefined, vi.fn()]
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.developer_mode.enabled') return [true, vi.fn()]
    return [key === 'chat.narrow_mode' ? false : 'none', vi.fn()]
  }
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
    session: { id: 'session-1', agentId: 'agent-1', traceId: 'trace-a', workspace: { path: '/tmp/workspace' } },
    isLoading: false,
    sessionSource: 'query',
    setActiveSessionId: vi.fn()
  } as {
    activeSessionId: string | null
    session:
      | { id: string; agentId: string | null; traceId?: string | null; workspace: { path: string } | null }
      | undefined
    isLoading: boolean
    sessionSource?: 'query' | 'pending' | 'none'
    setActiveSessionId: ReturnType<typeof vi.fn>
  }
}))

const agentSessionPartsMocks = vi.hoisted(() => ({
  useAgentSessionParts: vi.fn()
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn()
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: agentSessionPartsMocks.useAgentSessionParts
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

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/AgentChatNavbar', () => ({
  default: ({ tools }: { tools?: ReactNode }) => <div>{tools}</div>
}))

vi.mock('@renderer/components/chat/composer/variants/AgentComposer', () => ({
  default: ({ sendDisabled, sessionId }: { sendDisabled?: boolean; sessionId?: string }) => (
    <div data-testid="agent-composer" data-send-disabled={String(Boolean(sendDisabled))} data-session-id={sessionId} />
  ),
  AgentHomeComposer: ({ sendMessage }: { sendMessage?: (message: { text: string }) => Promise<void> | void }) => (
    <button type="button" data-testid="agent-home-composer" onClick={() => void sendMessage?.({ text: 'hello' })}>
      send draft message
    </button>
  ),
  MissingAgentHomeComposer: ({
    onAgentChange
  }: {
    onAgentChange?: (agentId: string | null) => void | Promise<void>
  }) => (
    <button type="button" data-testid="missing-agent-home-composer" onClick={() => void onAgentChange?.('agent-2')}>
      select missing agent
    </button>
  )
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: ({
    sessionId,
    openAgentToolFlow,
    openArtifactFile
  }: {
    sessionId: string
    openAgentToolFlow?: (input: any) => void
    openArtifactFile?: (path: string) => void
  }) => (
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
      <button type="button" onClick={() => openArtifactFile?.('/tmp/workspace/src/index.ts')}>
        open artifact file
      </button>
      <button type="button" onClick={() => openArtifactFile?.('/tmp/workspace/report.xlsx')}>
        open excel artifact file
      </button>
      <button type="button" onClick={() => openArtifactFile?.('/Users/suyao/Desktop/记忆商人.md')}>
        open desktop artifact file
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="citations-panel" data-open={String(open)} />
}))

describe('AgentChat artifact pane', () => {
  const activeSessionProps = () => ({
    activeSession: activeSessionMocks.result.session as ComponentProps<typeof AgentChat>['activeSession'],
    activeSessionLoading: activeSessionMocks.result.isLoading,
    activeSessionSource:
      activeSessionMocks.result.sessionSource ?? (activeSessionMocks.result.session ? 'query' : 'none')
  })
  const renderAgentChat = (props: ComponentProps<typeof AgentChat> = {}) =>
    render(<AgentChat {...activeSessionProps()} {...props} />)
  const rerenderAgentChat = (
    rerender: ReturnType<typeof render>['rerender'],
    props: ComponentProps<typeof AgentChat> = {}
  ) => rerender(<AgentChat {...activeSessionProps()} {...props} />)

  beforeEach(() => {
    agentSessionPartsMocks.useAgentSessionParts.mockReturnValue({
      messages: [],
      isLoading: false,
      hasOlder: false,
      loadOlder: vi.fn(),
      refresh: vi.fn(),
      seedReservedMessages: vi.fn(),
      deleteMessage: vi.fn()
    })
    activeSessionMocks.result = {
      activeSessionId: 'session-1',
      session: { id: 'session-1', agentId: 'agent-1', traceId: 'trace-a', workspace: { path: '/tmp/workspace' } },
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
        },
        file: {
          isTextFile: vi.fn().mockResolvedValue(true),
          getMetadata: vi.fn().mockResolvedValue({ kind: 'file', size: 1024 })
        }
      }
    })
  })

  it('opens and closes the artifact pane without replacing the existing chat shell pane', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    expect(screen.getByTestId('chat-app-shell')).toBeInTheDocument()
    expect(screen.getByTestId('chat-app-shell')).toHaveAttribute('data-pane-open', 'true')
    expect(screen.getByTestId('chat-app-shell')).toHaveAttribute('data-pane-position', 'left')
    expect(screen.getByTestId('session-pane')).toBeInTheDocument()
    expect(screen.queryByTestId('pinned-todo-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'false')

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })
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
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
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
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'select artifact file' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('chat-center-overlay')).toContainElement(screen.getByTestId('artifact-pane'))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')
  })

  it('keeps file tree UI state when maximizing and restoring the pane', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle artifact file tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'expand src folder' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'artifact file search' }), {
      target: { value: 'index' }
    })
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-tree-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-expanded-ids', 'src')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-search-keyword', 'index')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('chat-center-overlay')).toContainElement(screen.getByTestId('artifact-pane'))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-tree-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-expanded-ids', 'src')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-search-keyword', 'index')

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-tree-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-expanded-ids', 'src')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-search-keyword', 'index')
  })

  it('keeps file tree UI state when closing and reopening the pane', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'toggle artifact file tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'expand src folder' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'artifact file search' }), {
      target: { value: 'index' }
    })

    fireEvent.click(toggle)
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'false')

    fireEvent.click(toggle)
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-tree-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-expanded-ids', 'src')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-file-search-keyword', 'index')
  })

  it('mounts the artifact pane in preview mode when maximizing and restoring the pane', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'preview')

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.preview' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'code')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    expect(screen.queryByTestId('artifact-right-pane')).toBeNull()
    expect(screen.getByTestId('chat-center-overlay')).toContainElement(screen.getByTestId('artifact-pane'))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'preview')

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'preview')
  })

  it('resets the artifact view mode when the workspace changes', () => {
    const { rerender } = renderAgentChat({
      pane: <aside data-testid="session-pane" />,
      paneOpen: true,
      panePosition: 'left'
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.preview' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'code')

    activeSessionMocks.result = {
      ...activeSessionMocks.result,
      session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/other-workspace' } }
    }
    rerenderAgentChat(rerender, { pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-workspace-path', '/tmp/other-workspace')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-view-mode', 'preview')
  })

  it('prefers the draft session over a stale active session while rendering home placement', () => {
    renderAgentChat({
      draftConversation: {
        agentId: 'agent-1',
        workspaceSource: { type: 'user', workspaceId: 'workspace-1' },
        workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user' }
      } as any
    })

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-main-visible', 'false')
    expect(screen.getByTestId('composer-dock-home-header')).toHaveTextContent('agent.home.welcome_title')
    expect(screen.getByTestId('agent-home-composer')).toBeInTheDocument()
  })

  it('renders the missing-agent draft as a home composer without leasing a session', () => {
    activeSessionMocks.result = {
      activeSessionId: null,
      session: undefined,
      isLoading: false,
      setActiveSessionId: vi.fn()
    }
    const onMissingAgentDraftAgentChange = vi.fn()

    renderAgentChat({
      missingAgentDraft: true,
      onMissingAgentDraftAgentChange
    })

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-main-visible', 'false')
    expect(screen.getByTestId('composer-dock-home-header')).toHaveTextContent('agent.home.welcome_title')
    expect(screen.getByTestId('missing-agent-home-composer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'select missing agent' }))

    expect(onMissingAgentDraftAgentChange).toHaveBeenCalledWith('agent-2')
  })

  it('disables the artifact pane when switching into a draft session', async () => {
    const { rerender } = renderAgentChat({
      pane: <aside data-testid="session-pane" />,
      paneOpen: true,
      panePosition: 'left'
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')

    rerenderAgentChat(rerender, {
      pane: <aside data-testid="session-pane" />,
      paneOpen: true,
      panePosition: 'left',
      draftConversation: {
        agentId: 'agent-1',
        workspaceSource: { type: 'user', workspaceId: 'workspace-1' },
        workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user' }
      } as any
    })

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.queryByTestId('artifact-right-pane')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common.open_sidebar' })).toBeNull()
    expect(screen.queryByTestId('artifact-right-pane')).toBeNull()

    rerenderAgentChat(rerender, {
      pane: <aside data-testid="session-pane" />,
      paneOpen: true,
      panePosition: 'left'
    })

    expect(screen.getByRole('button', { name: 'common.open_sidebar' })).toBeEnabled()
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('keeps the resource list pane visible when switching from a draft to a persisted session', () => {
    const draftConversation = {
      agentId: 'agent-1',
      workspaceSource: { type: 'user', workspaceId: 'workspace-1' },
      workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user' }
    } as any

    const { rerender } = renderAgentChat({
      pane: <aside data-testid="session-pane" />,
      paneOpen: true,
      panePosition: 'left',
      draftConversation
    })

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('session-pane')).toBeInTheDocument()

    rerenderAgentChat(rerender, {
      pane: <aside data-testid="session-pane" />,
      paneOpen: true,
      panePosition: 'left'
    })

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'docked')
    expect(screen.getByTestId('session-pane')).toBeInTheDocument()
  })

  it('renders a loading shell during draft session handoff before the persistent session is available', async () => {
    activeSessionMocks.result = {
      activeSessionId: null,
      session: undefined,
      isLoading: false,
      setActiveSessionId: vi.fn()
    }
    const onEnsurePersistentSession = vi.fn(() => new Promise<never>(() => undefined))

    renderAgentChat({
      draftConversation: {
        agentId: 'agent-1',
        workspaceSource: { type: 'user', workspaceId: 'workspace-1' },
        workspace: { id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user' }
      } as any,
      onEnsurePersistentSession
    })

    fireEvent.click(screen.getByRole('button', { name: 'send draft message' }))

    await waitFor(() => {
      expect(screen.getByTestId('conversation-center-state')).toHaveAttribute('data-state', 'loading')
    })
    expect(onEnsurePersistentSession).toHaveBeenCalledWith('hello')
    expect(screen.queryByTestId('agent-home-composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('composer-dock-frame')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-messages')).not.toBeInTheDocument()
  })

  it('opens one right-pane tab per selected subagent flow', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'open flow a' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: /cache-usage\.md/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agent\.right_pane\.tabs\.flow/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'open flow b' }))

    expect(screen.getByRole('button', { name: /cache-usage\.md/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /renderer audit/ })).toBeInTheDocument()
    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
  })

  it('shows a permanent trace tab keyed on the session traceId when developer mode is on', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'common.open_sidebar' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: /trace\.label/ })).toBeInTheDocument()
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-topic-id', 'agent-session:session-1')
    expect(screen.getByTestId('trace-pane')).toHaveAttribute('data-trace-id', 'trace-a')
  })

  it('opens message file paths in a separate file preview tab', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'open artifact file' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: /index\.ts/ })).toBeInTheDocument()
    expect(screen.getByTestId('artifact-file-preview')).toHaveAttribute('data-workspace-path', '/tmp/workspace')
    expect(screen.getByTestId('artifact-file-preview')).toHaveAttribute('data-file-path', 'src/index.ts')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-workspace-path', '/tmp/workspace')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', '')
  })

  it('opens Excel file paths in an ordinary file preview tab without text sniffing', () => {
    const isTextFile = vi.mocked(window.api.file.isTextFile)

    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'open excel artifact file' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: /report\.xlsx/ })).toBeInTheDocument()
    expect(screen.getByTestId('artifact-file-preview')).toHaveAttribute('data-workspace-path', '/tmp/workspace')
    expect(screen.getByTestId('artifact-file-preview')).toHaveAttribute('data-file-path', 'report.xlsx')
    expect(screen.getByTestId('artifact-file-preview').parentElement).toHaveClass('overflow-auto')
    expect(screen.getByTestId('open-external-app-button')).toHaveAttribute('data-workdir', '/tmp/workspace')
    expect(screen.getByTestId('open-external-app-button')).toHaveAttribute('data-file-path', 'report.xlsx')
    expect(isTextFile).not.toHaveBeenCalledWith('/tmp/workspace/report.xlsx')
  })

  it('opens absolute file paths outside the workspace in a separate file preview tab', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'open desktop artifact file' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('button', { name: /记忆商人\.md/ })).toBeInTheDocument()
    expect(screen.getByTestId('artifact-file-preview')).toHaveAttribute('data-workspace-path', '/Users/suyao/Desktop')
    expect(screen.getByTestId('artifact-file-preview')).toHaveAttribute('data-file-path', '记忆商人.md')
    expect(screen.getByTestId('artifact-file-preview').parentElement).toHaveClass('overflow-auto')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-workspace-path', '/tmp/workspace')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', '')
  })

  it('removes the file preview tab when it is closed', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'open desktop artifact file' }))
    const fileTab = screen.getByRole('button', { name: /记忆商人\.md/ })
    fireEvent.click(within(fileTab.parentElement as HTMLElement).getByRole('button', { name: 'common.close' }))

    expect(screen.queryByRole('button', { name: /记忆商人\.md/ })).toBeNull()
    expect(screen.queryByTestId('artifact-file-preview')).toBeNull()
    expect(screen.getByTestId('artifact-pane')).toBeInTheDocument()
  })

  it('closes a subagent flow tab from its hover close button', () => {
    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

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

    const { rerender } = renderAgentChat({ pane: <SessionPane />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'pane count 0' }))
    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()

    activeSessionMocks.result = {
      activeSessionId: 'session-2',
      session: undefined,
      isLoading: true,
      setActiveSessionId: vi.fn()
    }
    rerenderAgentChat(rerender, { pane: <SessionPane />, paneOpen: true, panePosition: 'left' })

    expect(screen.getByRole('button', { name: /pane count/ })).toBeInTheDocument()
    expect(screen.queryByTestId('agent-messages')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-composer')).not.toBeInTheDocument()
  })

  it('keeps expanded session pane state when switching sessions', () => {
    const onSelectSession = vi.fn((sessionId: string) => {
      activeSessionMocks.result = {
        activeSessionId: sessionId,
        session: { id: sessionId, agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
        isLoading: false,
        sessionSource: 'pending',
        setActiveSessionId: vi.fn()
      }
    })

    function SessionPane() {
      const [expanded, setExpanded] = useState(false)
      const sessionIds = expanded ? ['session-1', 'session-2', 'session-3', 'session-4', 'session-5', 'session-6'] : []

      return (
        <aside>
          <button type="button" onClick={() => setExpanded(true)}>
            Expand display
          </button>
          {sessionIds.map((sessionId) => (
            <button type="button" key={sessionId} onClick={() => onSelectSession(sessionId)}>
              {sessionId}
            </button>
          ))}
        </aside>
      )
    }

    const { rerender } = renderAgentChat({ pane: <SessionPane />, paneOpen: true, panePosition: 'left' })

    fireEvent.click(screen.getByRole('button', { name: 'Expand display' }))
    expect(screen.getByRole('button', { name: 'session-6' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'session-6' }))

    expect(onSelectSession).toHaveBeenCalledWith('session-6')
    rerenderAgentChat(rerender, { pane: <SessionPane />, paneOpen: true, panePosition: 'left' })

    expect(screen.getByRole('button', { name: 'session-6' })).toBeInTheDocument()
    expect(screen.getByTestId('agent-messages')).toHaveAttribute('data-session-id', 'session-6')
    expect(agentSessionPartsMocks.useAgentSessionParts).toHaveBeenLastCalledWith(
      'session-6',
      expect.objectContaining({
        enabled: true,
        fetchOnMount: true
      })
    )
  })

  it('shows the persisted draft-created session while the active session query catches up', () => {
    const { rerender } = renderAgentChat({
      pane: <aside data-testid="session-pane" />,
      paneOpen: true,
      panePosition: 'left'
    })

    activeSessionMocks.result = {
      activeSessionId: 'draft-session-1',
      session: { id: 'draft-session-1', agentId: 'agent-1', workspace: { path: '/tmp/temp-workspace' } },
      isLoading: false,
      sessionSource: 'pending',
      setActiveSessionId: vi.fn()
    }
    rerenderAgentChat(rerender, { pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    expect(screen.getByTestId('agent-messages')).toHaveAttribute('data-session-id', 'draft-session-1')
    expect(screen.getByTestId('agent-composer')).toHaveAttribute('data-send-disabled', 'false')
  })

  it('shows history without composer for an unlinked session', () => {
    activeSessionMocks.result = {
      activeSessionId: 'session-unlinked',
      session: { id: 'session-unlinked', agentId: null, workspace: { path: '/tmp/workspace' } },
      isLoading: false,
      setActiveSessionId: vi.fn()
    }

    renderAgentChat({ pane: <aside data-testid="session-pane" />, paneOpen: true, panePosition: 'left' })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-messages')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-composer')).not.toBeInTheDocument()
  })
})
