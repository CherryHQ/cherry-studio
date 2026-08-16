import type * as CherryUi from '@cherrystudio/ui'
import {
  HoverCard as RealHoverCard,
  HoverCardContent as RealHoverCardContent,
  HoverCardTrigger as RealHoverCardTrigger
} from '@cherrystudio/ui/components'
import type * as ArtifactPanePath from '@renderer/components/chat/panes/artifactPanePath'
import { useRightPanelState } from '@renderer/components/chat/panes/Shell'
import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { PhysicalFileMetadata } from '@shared/types/file'
import { TreeDir, TreeDirRoot, TreeFile } from '@shared/utils/file'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  CSSProperties,
  PropsWithChildren,
  ReactElement,
  ReactNode
} from 'react'
import { cloneElement, isValidElement, useEffect, useSyncExternalStore } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AgentRightPaneProjection from '../agentRightPaneProjection'

const {
  buildAgentToolFlowProjectionMock,
  fileSessionDiscardMock,
  fileSessionFlushMock,
  fileSessionState,
  fileTreeModelState,
  fileTreeModelStore,
  resolveArtifactPaneFileSelectionMock,
  systemFileTreeState,
  tracePaneModuleLoadMock,
  useArtifactFileTreeModelMock,
  useCommandHandlerMock,
  useDirectoryTreeMock,
  ipcRequestMock,
  toastErrorMock,
  uiMockState,
  backgroundTasksState,
  taskEventsState,
  stableI18n,
  toolResultState
} = vi.hoisted(() => ({
  buildAgentToolFlowProjectionMock: vi.fn(),
  fileSessionDiscardMock: vi.fn(),
  fileSessionFlushMock: vi.fn().mockResolvedValue(undefined),
  fileSessionState: {
    isDirty: false,
    isSaving: false,
    saveError: undefined as Error | undefined,
    metadataRecoveryPending: false
  },
  fileTreeModelState: {
    hasLoaded: false,
    nodeById: new Map<string, { kind: string }>()
  },
  fileTreeModelStore: {
    listeners: new Set<() => void>(),
    revision: 0
  },
  resolveArtifactPaneFileSelectionMock: vi.fn(),
  systemFileTreeState: {
    root: null as TreeDirRoot | null,
    version: 0
  },
  tracePaneModuleLoadMock: vi.fn(),
  useArtifactFileTreeModelMock: vi.fn(),
  useCommandHandlerMock: vi.fn(),
  useDirectoryTreeMock: vi.fn(),
  ipcRequestMock: vi.fn(),
  toastErrorMock: vi.fn(),
  uiMockState: { useRealHoverCard: false },
  backgroundTasksState: {
    tasks: [] as Array<{ id: string; type: string; description: string; toolCallId?: string }>
  },
  taskEventsState: {
    events: {} as Record<string, Record<string, unknown>>
  },
  stableI18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  toolResultState: { output: 'Loaded flow result' as unknown }
}))

vi.mock('../agentRightPaneProjection', async (importActual) => {
  const actual = await importActual<typeof AgentRightPaneProjection>()
  return {
    ...actual,
    buildAgentToolFlowProjection: (...args: Parameters<typeof actual.buildAgentToolFlowProjection>) => {
      buildAgentToolFlowProjectionMock(...args)
      return actual.buildAgentToolFlowProjection(...args)
    }
  }
})

vi.mock('@cherrystudio/ui', async (importActual) => {
  const actual = await importActual<typeof CherryUi>()
  return {
    Accordion: actual.Accordion,
    AccordionContent: actual.AccordionContent,
    AccordionItem: actual.AccordionItem,
    AccordionTrigger: actual.AccordionTrigger,
    Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    CircularProgress: ({ value }: { value: number }) => (
      <span data-testid="circular-progress" data-value={String(value)} />
    ),
    ConfirmDialog: ({
      cancelText,
      confirmLoading,
      confirmText,
      description,
      onConfirm,
      onOpenChange,
      open,
      title
    }: {
      cancelText: string
      confirmLoading?: boolean
      confirmText: string
      description: string
      onConfirm: () => void
      onOpenChange: (open: boolean) => void
      open: boolean
      title: string
    }) =>
      open ? (
        <div role="dialog">
          <div>{title}</div>
          <div>{description}</div>
          <button type="button" onClick={() => onOpenChange(false)}>
            {cancelText}
          </button>
          <button type="button" disabled={confirmLoading} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      ) : null,
    HoverCard: (props: ComponentProps<typeof RealHoverCard>) =>
      uiMockState.useRealHoverCard ? <RealHoverCard {...props} /> : <div>{props.children}</div>,
    HoverCardContent: (props: ComponentProps<typeof RealHoverCardContent>) =>
      uiMockState.useRealHoverCard ? (
        <RealHoverCardContent {...props} />
      ) : (
        <div className={props.className} data-testid="status-shortcut-preview">
          {props.children}
        </div>
      ),
    HoverCardTrigger: (props: ComponentProps<typeof RealHoverCardTrigger>) => {
      if (uiMockState.useRealHoverCard) return <RealHoverCardTrigger {...props} />
      return isValidElement(props.children) ? (
        // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
        cloneElement(props.children as ReactElement<Record<string, unknown>>, { 'data-hover-card-trigger': 'true' })
      ) : (
        <>{props.children}</>
      )
    },
    HorizontalScrollContainer: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Tabs: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
    TabsTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
  }
})

vi.mock('@renderer/components/chat/messages/tools/agent', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  TerminalOutput: ({ command, content }: { command?: string; content: string }) => (
    <pre>
      {command ? <span>{command}</span> : null}
      {command && content ? '\n\n' : null}
      {content ? <span>{content}</span> : null}
    </pre>
  )
}))

vi.mock('@renderer/components/chat/shell/RightPaneHost', () => ({
  PersistentRightPaneHost: ({
    children,
    maximized,
    onLayoutAnimationComplete,
    open,
    style
  }: PropsWithChildren<{
    maximized?: boolean
    onLayoutAnimationComplete?: (mode: 'closed' | 'docked' | 'maximized') => void
    open?: boolean
    style?: CSSProperties
  }>) => {
    useEffect(() => {
      onLayoutAnimationComplete?.(!open ? 'closed' : maximized ? 'maximized' : 'docked')
    }, [maximized, onLayoutAnimationComplete, open])

    return (
      <section
        data-testid="right-pane"
        data-open={String(Boolean(open))}
        data-maximized={String(Boolean(maximized))}
        style={style}>
        {children}
      </section>
    )
  }
}))

vi.mock('@renderer/components/chat/primitives', async (importActual) => ({
  ...(await importActual<typeof ChatPrimitives>()),
  EmptyState: () => <div data-testid="empty-state" />
}))

vi.mock('@renderer/components/chat/agent/AgentContextUsageSummary', () => ({
  AgentContextUsageSummary: () => <div data-testid="context-usage" />
}))

vi.mock('@renderer/components/chat/messages/MessageList', () => ({
  default: () => <div data-testid="message-list" />
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  MessageListProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastErrorMock, success: vi.fn() }
}))

vi.mock('@renderer/utils/filePath', () => ({
  resolveInlineFilePath: (path: string) => path
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', async () => ({
  ArtifactPaneView: ({
    editMode,
    onEditModeChange,
    headerVariant,
    onPreviewClose,
    onSelectedFileChange,
    paneActions,
    paneTitle,
    previewFileSelection,
    selectedFile
  }: {
    editMode?: 'preview' | 'edit'
    onEditModeChange?: (mode: 'preview' | 'edit') => void
    headerVariant?: 'overlay' | 'pane'
    onPreviewClose?: () => void
    onSelectedFileChange: (file: string | null) => void
    paneActions?: ReactNode
    paneTitle?: ReactNode
    previewFileSelection?: { workspacePath: string; filePath: string } | null
    selectedFile: string | null
  }) => (
    <div data-testid="artifact-pane" data-edit-mode={editMode} data-selected-file={selectedFile ?? ''}>
      {headerVariant === 'pane' ? (
        <div data-testid="artifact-pane-header">
          {previewFileSelection ? (
            <button type="button" aria-label="common.back" onClick={onPreviewClose}>
              back
            </button>
          ) : null}
          <span data-testid="artifact-pane-header-title">{previewFileSelection?.filePath ?? paneTitle}</span>
          {paneActions}
        </div>
      ) : null}
      <button type="button" onClick={() => onSelectedFileChange('README.md')}>
        select README.md
      </button>
      <button type="button" onClick={() => onSelectedFileChange('src/deep.ts')}>
        select src/deep.ts
      </button>
      <button type="button" onClick={() => onEditModeChange?.('edit')}>
        edit
      </button>
      <button type="button" onClick={() => onEditModeChange?.('preview')}>
        preview
      </button>
      {previewFileSelection && (
        <div data-testid="artifact-file-preview-overlay">
          {previewFileSelection.filePath}
          {headerVariant === 'pane' ? null : (
            <button type="button" onClick={onPreviewClose}>
              close
            </button>
          )}
        </div>
      )}
    </div>
  ),
  getArtifactPaneSelectionPath: (
    await vi.importActual<typeof ArtifactPanePath>('@renderer/components/chat/panes/artifactPanePath')
  ).getArtifactPaneSelectionPath,
  resolveArtifactPaneFileSelection: (...args: unknown[]) => resolveArtifactPaneFileSelectionMock(...args)
}))

vi.mock('@renderer/components/chat/panes/OpenExternalAppButton', () => ({
  default: () => <button type="button">Open external</button>
}))

vi.mock('@renderer/hooks/useFileEditSession', () => {
  const fileSessionMock = {
    status: 'idle',
    savedContent: '',
    draft: '',
    get isDirty() {
      return fileSessionState.isDirty
    },
    get isSaving() {
      return fileSessionState.isSaving
    },
    conflict: false,
    get saveError() {
      return fileSessionState.saveError
    },
    get metadataRecoveryPending() {
      return fileSessionState.metadataRecoveryPending
    },
    setDraft: vi.fn(),
    discard: fileSessionDiscardMock,
    reload: vi.fn(),
    flush: fileSessionFlushMock,
    notifyExternalChange: vi.fn()
  }

  return { useFileEditSession: () => fileSessionMock }
})

vi.mock('@renderer/components/chat/panes/useArtifactFileTreeModel', () => ({
  ARTIFACT_MISSING_WORKSPACE_TREE_OPTIONS: { watchMissingRoot: true },
  isSelectableFileNode: (nodeById: ReadonlyMap<string, { kind: string }>, selectedFile: string | null) =>
    Boolean(selectedFile && nodeById.get(selectedFile)?.kind === 'file'),
  useArtifactFileTreeModel: (options: unknown) => {
    useSyncExternalStore(
      (listener) => {
        fileTreeModelStore.listeners.add(listener)
        return () => fileTreeModelStore.listeners.delete(listener)
      },
      () => fileTreeModelStore.revision
    )
    return useArtifactFileTreeModelMock(options)
  }
}))

vi.mock('@renderer/components/chat/trace/TracePane', () => {
  tracePaneModuleLoadMock()
  return { TracePane: () => <div data-testid="trace-pane" /> }
})

vi.mock('@renderer/components/command', () => ({
  CommandTooltip: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => (key === 'app.developer_mode.enabled' ? [true, vi.fn()] : [undefined, vi.fn()])
}))

vi.mock('@renderer/hooks/agent/useAgentSessionCompaction', () => ({
  useAgentSessionCompaction: () => ({ status: 'idle' })
}))

vi.mock('@renderer/hooks/agent/useAgentSessionContextUsage', () => ({
  useAgentSessionContextUsage: () => ({ percentage: null, usage: null })
}))

vi.mock('@renderer/hooks/agent/useAgentSessionBackgroundTasks', () => ({
  useAgentSessionBackgroundTasks: () => backgroundTasksState.tasks
}))

vi.mock('@renderer/hooks/agent/useAgentSessionTaskEvents', () => ({
  useAgentSessionTaskEvents: () => taskEventsState.events
}))

// A live turn: run-task rows render the status their events report. Staleness is covered where the
// rule lives, in the projection tests.
vi.mock('@renderer/hooks/agent/useAgentSessionStreamStatuses', () => ({
  useAgentSessionStreamStatuses: (sessionIds: readonly string[]) =>
    new Map(sessionIds.map((sessionId) => [sessionId, { isPending: true, status: 'streaming' }]))
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: useCommandHandlerMock
}))

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => true
}))

vi.mock('@renderer/hooks/useFileSize', () => ({
  useFileSize: () => undefined
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: useDirectoryTreeMock
}))

vi.mock('@renderer/hooks/useIsTextFile', () => ({
  useIsTextFile: () => 'text'
}))

vi.mock('@renderer/pages/agents/messages/agentMessageListAdapter', () => ({
  useAgentMessageListProviderValue: () => ({
    state: {
      renderConfig: {}
    }
  })
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>
  },
  useReducedMotion: () => false
}))

// A stable `t` identity mirrors production react-i18next; a fresh closure per render
// would invalidate the provider's scope memo and break render-isolation assertions.
const stableT = (key: string, values?: Record<string, unknown>) =>
  key === 'agent.right_pane.status.task_progress_compact' ? `Step ${values?.current}/${values?.total}` : key
vi.mock('@renderer/i18n/resolver', () => ({ default: stableI18n }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: stableI18n, t: stableT })
}))

import { AgentRightPane, AgentTaskProgressCapsule, useAgentRightPaneActions } from '../AgentRightPane'

type TestAgentRightPaneProps = ComponentProps<typeof AgentRightPane.Scope>
const TEST_SWR_CONFIG = { provider: () => new Map() }

function createTaskPart(sequence: number, subject: string, activeForm?: string): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId: `task-create-${sequence}`,
    toolName: 'TaskCreate',
    state: 'input-available',
    input: { subject, activeForm }
  } as unknown as CherryMessagePart
}

function updateTaskPart(
  sequence: number,
  taskId: string,
  status: 'completed' | 'in_progress',
  activeForm?: string
): CherryMessagePart {
  return {
    type: 'dynamic-tool',
    toolCallId: `task-update-${sequence}`,
    toolName: 'TaskUpdate',
    state: 'input-available',
    input: { taskId, status, activeForm }
  } as unknown as CherryMessagePart
}

function createTaskMessages(parts: CherryMessagePart[], status: 'pending' | 'success'): CherryUIMessage[] {
  return [{ id: 'm1', role: 'assistant', parts, metadata: { status } }] as CherryUIMessage[]
}

function TestAgentRightPane({
  children,
  defaultOpen,
  onOpenChange,
  resourcePane,
  ...scopeProps
}: TestAgentRightPaneProps) {
  return (
    <SWRConfig value={TEST_SWR_CONFIG}>
      <AgentRightPane.Scope
        {...scopeProps}
        agentType={scopeProps.agentType ?? 'claude-code'}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        resourcePane={resourcePane}>
        {children}
      </AgentRightPane.Scope>
    </SWRConfig>
  )
}

function OpenFlowButton({
  label = 'open flow',
  title = 'Inspect flow',
  toolCallId = 'flow-1',
  agentName
}: {
  label?: string
  title?: string
  toolCallId?: string
  agentName?: string
}) {
  const { openAgentToolFlow } = useAgentRightPaneActions()

  return (
    <button type="button" onClick={() => openAgentToolFlow({ toolCallId, toolName: 'task', title, agentName })}>
      {label}
    </button>
  )
}

function ArtifactCapabilityProbe() {
  const { canOpenArtifactFile } = useAgentRightPaneActions()
  return <output data-testid="can-open-artifact-file">{String(canOpenArtifactFile)}</output>
}

function OpenArtifactButton({ path = 'report.md' }: { path?: string }) {
  const { openArtifactFile } = useAgentRightPaneActions()
  return (
    <button type="button" onClick={() => openArtifactFile(path)}>
      open artifact
    </button>
  )
}

function UserOpenSeqProbe() {
  const { userOpenSeq } = useRightPanelState()
  return <output data-testid="user-open-seq">{userOpenSeq}</output>
}

type StatusTaskFixture = {
  id: string
  status: 'pending' | 'in_progress' | 'completed' | 'stopped' | 'error'
  title: string
  taskType?: string
  subagentType?: string
  toolUseId?: string
  description?: string
  workflowName?: string
  isBackgrounded?: boolean
  createdAt?: string
  completedAt?: string
  usage?: { totalTokens?: number; contextTokens?: number; toolUses?: number; durationMs?: number }
}

function renderStatusTasks(tasks: StatusTaskFixture[], { openPanel = true }: { openPanel?: boolean } = {}) {
  const parts = tasks.map(
    (task) =>
      ({
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: task.id,
          status: task.status,
          title: task.title,
          taskType: task.taskType,
          subagentType: task.subagentType,
          toolUseId: task.toolUseId,
          description: task.description,
          workflowName: task.workflowName,
          isBackgrounded: task.isBackgrounded,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          usage: task.usage
        }
      }) as unknown as CherryMessagePart
  )
  const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]

  render(
    <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
      <AgentRightPane.Shortcuts />
      <AgentRightPane.Viewport />
    </TestAgentRightPane>
  )

  if (openPanel) {
    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))
  }
}

describe('AgentRightPane', () => {
  const triggerRightSidebarShortcut = () => {
    const handler = useCommandHandlerMock.mock.calls
      .filter(([command]) => command === 'topic.sidebar.toggle')
      .at(-1)?.[1] as (() => void) | undefined

    expect(handler).toBeDefined()
    handler?.()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    uiMockState.useRealHoverCard = false
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    toolResultState.output = 'Loaded flow result'
    ipcRequestMock.mockImplementation((channel: string) => {
      if (channel === 'ai.tool.get_result') {
        return Promise.resolve({ found: true, output: toolResultState.output })
      }
      return Promise.resolve({
        kind: 'file',
        type: 'text',
        size: 1,
        createdAt: 1,
        modifiedAt: 1,
        mime: 'text/plain'
      })
    })
    fileSessionState.isDirty = false
    fileSessionState.isSaving = false
    fileSessionState.saveError = undefined
    fileTreeModelState.hasLoaded = false
    fileTreeModelState.nodeById = new Map()
    fileTreeModelStore.listeners.clear()
    fileTreeModelStore.revision = 0
    resolveArtifactPaneFileSelectionMock.mockReturnValue(null)
    systemFileTreeState.root = new TreeDirRoot('/system-workspace')
    backgroundTasksState.tasks = []
    taskEventsState.events = {}
    systemFileTreeState.version = 0
    useDirectoryTreeMock.mockImplementation(() => systemFileTreeState)
    useArtifactFileTreeModelMock.mockImplementation(() => ({
      hasLoaded: fileTreeModelState.hasLoaded,
      nodeById: fileTreeModelState.nodeById
    }))
  })

  it('opens the current task plan from hover and keyboard focus, then hides it after completion', async () => {
    uiMockState.useRealHoverCard = true
    const user = userEvent.setup()
    const parts = [
      createTaskPart(1, 'Collect context'),
      createTaskPart(2, 'Build a capsule with a long wrapping task title'),
      updateTaskPart(1, '1', 'completed'),
      updateTaskPart(2, '2', 'in_progress', 'Building capsule')
    ]
    const messages = createTaskMessages(parts, 'pending')

    const view = render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentTaskProgressCapsule />
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    const capsule = screen.getByTestId('agent-task-progress-capsule')
    const progress = within(capsule).getByRole('progressbar')
    const progressLabel = within(capsule).getByText('Step 2/2')

    expect(progress).toHaveAttribute('aria-valuenow', '1')
    expect(progress).toHaveAttribute('aria-valuemax', '2')
    expect(screen.getByTestId('circular-progress')).toHaveAttribute('data-value', '50')
    expect(screen.queryByTestId('agent-task-progress-details')).toBeNull()

    await user.hover(progressLabel)
    expect(within(await screen.findByTestId('agent-task-progress-details')).getByText('Building capsule')).toBeVisible()

    await user.unhover(progressLabel)
    await waitFor(() => expect(screen.queryByTestId('agent-task-progress-details')).toBeNull())

    await user.tab()
    expect(document.activeElement).toHaveTextContent('Step 2/2')
    expect(within(await screen.findByTestId('agent-task-progress-details')).getByText('Building capsule')).toBeVisible()

    const completedParts = [...parts, updateTaskPart(3, '2', 'completed')]
    const completedMessages = createTaskMessages(completedParts, 'success')

    view.rerender(
      <TestAgentRightPane sessionId="session-a" messages={completedMessages} partsByMessageId={{ m1: completedParts }}>
        <AgentTaskProgressCapsule />
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByTestId('agent-task-progress-capsule')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    expect(within(screen.getByTestId('right-pane')).queryByText('Collect context')).toBeNull()
  })

  it('infers the first pending task as active only while the assistant turn is running', () => {
    const parts = [createTaskPart(1, 'Collect context', 'Collecting context'), createTaskPart(2, 'Build capsule')]
    const messages = createTaskMessages(parts, 'pending')

    const view = render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentTaskProgressCapsule />
      </TestAgentRightPane>
    )

    const capsule = screen.getByTestId('agent-task-progress-capsule')
    expect(within(capsule).getByText('Step 1/2')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('agent-task-progress-details')).getByText('Collecting context')
    ).toBeInTheDocument()

    const settledMessages = createTaskMessages(parts, 'success')
    view.rerender(
      <TestAgentRightPane sessionId="session-a" messages={settledMessages} partsByMessageId={{ m1: parts }}>
        <AgentTaskProgressCapsule />
      </TestAgentRightPane>
    )

    expect(within(screen.getByTestId('agent-task-progress-details')).getByText('Collect context')).toBeInTheDocument()
    expect(screen.queryByText('Collecting context')).toBeNull()
  })

  it('uses a title header and keeps stable shortcuts available while the pane is open', () => {
    render(
      <TestAgentRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'agent.session.list.title' }}
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByRole('button', { name: 'agent.session.list.title' })).toBeNull()
    expect(screen.getByRole('button', { name: 'agent.right_pane.tabs.files' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'trace.label' })).toBeInTheDocument()
    expect(screen.getByTestId('status-shortcut-preview')).toBeInTheDocument()

    const statusShortcut = document.querySelector('[data-shell-tab-shortcut="status"]')
    expect(statusShortcut).toBeInTheDocument()
    expect(statusShortcut).toHaveAttribute('data-hover-card-trigger', 'true')

    fireEvent.click(statusShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('agent.right_pane.tabs.status')
    expect(document.querySelector('button[data-state="open"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull()
    expect(screen.queryByTestId('status-shortcut-preview')).toBeNull()

    const activeStatusShortcut = document.querySelector('[data-shell-tab-shortcut="status"]')
    expect(activeStatusShortcut).toBeInTheDocument()
    expect(activeStatusShortcut).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(activeStatusShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('registers the sidebar command independently and prioritizes the resource pane', () => {
    render(
      <TestAgentRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'agent.session.list.title' }}
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(useCommandHandlerMock).toHaveBeenCalledWith(
      'topic.sidebar.toggle',
      expect.any(Function),
      expect.objectContaining({ enabled: true })
    )

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('resource-list')).toBeInTheDocument()

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('opens files from the sidebar command when no resource pane is available', () => {
    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.queryByTestId('shell-tab-title')).toBeNull()
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('agent.right_pane.tabs.files')
    expect(screen.getByTestId('artifact-pane')).toBeInTheDocument()
  })

  it('reuses the files pane header for preview navigation', () => {
    render(
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.getAllByTestId('artifact-pane-header')).toHaveLength(1)
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('agent.right_pane.tabs.files')

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))

    expect(screen.getAllByTestId('artifact-pane-header')).toHaveLength(1)
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('README.md')
    expect(screen.getByRole('button', { name: 'common.back' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('agent.right_pane.tabs.files')
  })

  it('does not expose artifact opening without a workspace path', () => {
    const { rerender } = render(
      <TestAgentRightPane sessionId="session-a" messages={[]} partsByMessageId={{}}>
        <ArtifactCapabilityProbe />
        <AgentRightPane.Shortcuts />
      </TestAgentRightPane>
    )

    expect(screen.getByTestId('can-open-artifact-file')).toHaveTextContent('false')
    expect(screen.queryByRole('button', { name: 'agent.right_pane.tabs.files' })).toBeNull()

    rerender(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        workspaceType="user"
        messages={[]}
        partsByMessageId={{}}>
        <ArtifactCapabilityProbe />
        <AgentRightPane.Shortcuts />
      </TestAgentRightPane>
    )

    expect(screen.getByTestId('can-open-artifact-file')).toHaveTextContent('true')
    expect(screen.getByRole('button', { name: 'agent.right_pane.tabs.files' })).toBeInTheDocument()
  })

  it('shows the files shortcut only after a system workspace contains a file', () => {
    const { rerender } = render(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/system-workspace"
        workspaceType="system"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByRole('button', { name: 'agent.right_pane.tabs.files' })).toBeNull()
    expect(useDirectoryTreeMock).toHaveBeenLastCalledWith('/system-workspace', { watchMissingRoot: true })

    const systemWorkspaceRoot = systemFileTreeState.root
    if (!systemWorkspaceRoot) throw new Error('Expected the system workspace tree root')
    const outputDirectory = new TreeDir({ path: '/system-workspace/output' })
    systemWorkspaceRoot.attachChild(outputDirectory)
    systemFileTreeState.version += 1
    rerender(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/system-workspace"
        workspaceType="system"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByRole('button', { name: 'agent.right_pane.tabs.files' })).toBeNull()

    outputDirectory.attachChild(new TreeFile({ path: '/system-workspace/output/artifact.md' }))
    systemFileTreeState.version += 1
    rerender(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/system-workspace"
        workspaceType="system"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.files' }))
    expect(useArtifactFileTreeModelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ watchMissingRoot: true, workspacePath: '/system-workspace' })
    )
  })

  it('does not request a system workspace tree for a relative path', () => {
    render(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="relative/workspace"
        workspaceType="system"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(useDirectoryTreeMock).toHaveBeenLastCalledWith(undefined, { watchMissingRoot: true })
  })

  it('hides conversation shortcuts when the conversation is unavailable', () => {
    render(
      <TestAgentRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'agent.session.list.title' }}
        conversationState="unavailable"
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByRole('button', { name: 'agent.session.list.title' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'agent.right_pane.tabs.files' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'agent.right_pane.tabs.status' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'trace.label' })).toBeNull()
  })

  it('resolves a dynamic flow panel from the declared flow capability', () => {
    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <OpenFlowButton />
        <UserOpenSeqProbe />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.getByTestId('user-open-seq')).toHaveTextContent('0')
    fireEvent.click(screen.getByRole('button', { name: 'open flow' }))

    expect(screen.getByTestId('user-open-seq')).toHaveTextContent('1')
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('Inspect flow')
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(useArtifactFileTreeModelMock).not.toHaveBeenCalled()
  })

  it('keeps the full flow title for the panel header to truncate by available width', () => {
    const title = 'Review shared layer and IPC session boundaries without pre-truncating the title'

    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <OpenFlowButton title={title} />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open flow' }))

    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent(title)
  })

  it('resolves a deferred selected flow output by its stored address', async () => {
    const deferredToolResult = { topicId: 'agent-session:session-a', messageId: 'm1', toolCallId: 'flow-1' }
    const flowPart = {
      type: 'dynamic-tool',
      toolCallId: 'flow-1',
      toolName: 'Agent',
      state: 'output-available',
      input: { prompt: 'Inspect the workspace' },
      output: { $deferredToolResult: deferredToolResult }
    } as unknown as CherryMessagePart
    const messages = [{ id: 'm1', role: 'assistant', parts: [flowPart], metadata: {} }] as CherryUIMessage[]

    render(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        messages={messages}
        partsByMessageId={{ m1: [flowPart] }}>
        <OpenFlowButton toolCallId="flow-1" />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open flow' }))

    await waitFor(() =>
      expect(buildAgentToolFlowProjectionMock).toHaveBeenLastCalledWith(
        messages,
        { m1: [flowPart] },
        'flow-1',
        'Loaded flow result'
      )
    )
  })

  it('marks direct artifact opening as user initiated', async () => {
    resolveArtifactPaneFileSelectionMock.mockReturnValue({
      workspacePath: '/workspace',
      filePath: 'report.md'
    })

    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <OpenArtifactButton />
        <UserOpenSeqProbe />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.getByTestId('user-open-seq')).toHaveTextContent('0')
    fireEvent.click(screen.getByRole('button', { name: 'open artifact' }))

    expect(screen.getByTestId('user-open-seq')).toHaveTextContent('1')
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('report.md')
    })
    expect(ipcRequestMock).toHaveBeenCalledWith('file.get_metadata', {
      kind: 'path',
      path: '/workspace/report.md'
    })
  })

  it('rejects direct relative artifact opening from a relative workspace before metadata lookup', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)

    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="relative/workspace" messages={[]} partsByMessageId={{}}>
        <OpenArtifactButton />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open artifact' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(ipcRequestMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
  })

  it('ignores a stale artifact metadata resolution after the workspace switches', async () => {
    resolveArtifactPaneFileSelectionMock.mockReturnValue({
      workspacePath: '/workspace-a',
      filePath: 'report.md'
    })
    let resolveMetadata: (metadata: PhysicalFileMetadata | null) => void = () => {}
    ipcRequestMock.mockImplementationOnce(
      () =>
        new Promise<PhysicalFileMetadata | null>((resolve) => {
          resolveMetadata = resolve
        })
    )
    const renderPane = (workspacePath: string) => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath={workspacePath}
        messages={[]}
        partsByMessageId={{}}>
        <OpenArtifactButton />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    const { rerender } = render(renderPane('/workspace-a'))

    fireEvent.click(screen.getByRole('button', { name: 'open artifact' }))
    rerender(renderPane('/workspace-b'))

    await act(async () => {
      resolveMetadata({ kind: 'file', type: 'text', size: 1, createdAt: 1, modifiedAt: 1, mime: 'text/plain' })
    })

    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('agent.right_pane.tabs.files')
  })

  it('opens the files pane without previewing a declared directory', async () => {
    ipcRequestMock.mockResolvedValue({
      kind: 'directory',
      size: 0,
      createdAt: 1,
      modifiedAt: 1
    })
    resolveArtifactPaneFileSelectionMock.mockReturnValue({
      workspacePath: '/workspace',
      filePath: 'html in canvas'
    })

    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <OpenArtifactButton path="html in canvas" />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open artifact' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    await waitFor(() => {
      expect(ipcRequestMock).toHaveBeenCalledWith('file.get_metadata', {
        kind: 'path',
        path: '/workspace/html in canvas'
      })
    })
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('agent.right_pane.tabs.files')
    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
  })

  it('replaces the retained flow when another flow is opened', () => {
    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <OpenFlowButton />
        <OpenFlowButton label="open second flow" title="Inspect second flow" toolCallId="flow-2" />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open flow' }))
    const firstFlow = screen.getByTestId('empty-state')

    fireEvent.click(screen.getByRole('button', { name: 'open second flow' }))

    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('Inspect second flow')
    expect(screen.getByTestId('empty-state')).not.toBe(firstFlow)
  })

  it('retains an inactive flow without re-projecting every runtime update', () => {
    const flowPart = {
      type: 'dynamic-tool',
      toolCallId: 'flow-1',
      toolName: 'task',
      state: 'input-available',
      input: { prompt: 'Inspect the workspace' }
    } as unknown as CherryMessagePart
    const messages = [{ id: 'm1', role: 'assistant', parts: [flowPart], metadata: {} }] as CherryUIMessage[]
    const { rerender } = render(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        messages={messages}
        partsByMessageId={{ m1: [flowPart] }}>
        <OpenFlowButton />
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open flow' }))
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
    const callsWhileActive = buildAgentToolFlowProjectionMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.files' }))
    rerender(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[...messages]}
        partsByMessageId={{ m1: [flowPart] }}>
        <OpenFlowButton />
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(buildAgentToolFlowProjectionMock).toHaveBeenCalledTimes(callsWhileActive)
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
  })

  it('opens a subagent flow from the shortcut environment context', async () => {
    const user = userEvent.setup()
    renderStatusTasks(
      [
        {
          id: 'subagent-1',
          status: 'completed',
          title: 'Inspect task state',
          description: 'Inspect the task projection and event merge path',
          taskType: 'local_agent',
          subagentType: 'general-purpose',
          toolUseId: 'tool-use-1',
          usage: { totalTokens: 2400, contextTokens: 800, toolUses: 7, durationMs: 5000 }
        }
      ],
      { openPanel: false }
    )

    const preview = screen.getByTestId('status-shortcut-preview')
    const contextUsage = within(preview).getByTestId('context-usage')
    const taskButton = within(preview).getByTitle('agent.right_pane.status.view_details')
    expect(contextUsage.compareDocumentPosition(taskButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(taskButton).toHaveClass('focus-visible:bg-accent', 'focus-visible:outline-none')
    expect(taskButton).not.toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring')
    expect(within(taskButton).getByText('general-purpose')).toBeInTheDocument()
    expect(within(taskButton).getByText('agent.right_pane.status.total·2.4K')).toBeInTheDocument()
    expect(within(taskButton).getByText('agent.right_pane.status.context_size·800')).toBeInTheDocument()
    expect(within(taskButton).getByText('agent.right_pane.status.tools·7')).toBeInTheDocument()
    const syncLabel = within(taskButton).getByText('agent.right_pane.status.execution_sync')
    const duration = within(taskButton).getByText('5s')
    expect(syncLabel.compareDocumentPosition(duration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(within(taskButton).getByText('agent.right_pane.status.total·2.4K'))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    const flowHeader = screen.getByTestId('shell-tab-title')
    expect(flowHeader).toHaveTextContent('Inspect task state')
    expect(flowHeader).toHaveTextContent('general-purpose')
    const clipboardWriteText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await user.click(within(flowHeader).getByRole('button', { name: 'agent.right_pane.status.copy_agent_name' }))
    expect(clipboardWriteText).toHaveBeenCalledExactlyOnceWith('general-purpose')

    await user.click(screen.getByRole('button', { name: 'common.back' }))
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('agent.right_pane.tabs.status')
    clipboardWriteText.mockRestore()
  })

  it('labels a detached single Agent as asynchronous before its duration', () => {
    renderStatusTasks([
      {
        id: 'subagent-async',
        status: 'in_progress',
        title: 'Inspect asynchronously',
        taskType: 'local_agent',
        subagentType: 'general-purpose',
        toolUseId: 'tool-use-async',
        isBackgrounded: true,
        usage: { durationMs: 5000 }
      }
    ])

    const taskButton = screen.getByTitle('agent.right_pane.status.view_details')
    const asyncLabel = within(taskButton).getByText('agent.right_pane.status.execution_async')
    const duration = within(taskButton).getByText('5s')
    expect(asyncLabel.compareDocumentPosition(duration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows ASCII hyphens when single-Agent statistics are unavailable', () => {
    renderStatusTasks([
      {
        id: 'subagent-empty-stats',
        status: 'in_progress',
        title: 'Inspect without statistics',
        taskType: 'local_agent',
        subagentType: 'general-purpose',
        toolUseId: 'tool-use-empty-stats'
      }
    ])

    const taskButton = screen.getByTitle('agent.right_pane.status.view_details')
    expect(within(taskButton).getByText('agent.right_pane.status.total·-')).toBeInTheDocument()
    expect(within(taskButton).getByText('agent.right_pane.status.context_size·-')).toBeInTheDocument()
    expect(within(taskButton).getByText('agent.right_pane.status.tools·-')).toBeInTheDocument()
  })

  it('does not open a Claude-only agent flow for a pi runtime', async () => {
    const user = userEvent.setup()
    render(
      <TestAgentRightPane agentType="pi" sessionId="session-a" messages={[]} partsByMessageId={{}}>
        <OpenFlowButton />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    await user.click(screen.getByRole('button', { name: 'open flow' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('keeps the internal launch receipt collapsed below the child message flow', async () => {
    const user = userEvent.setup()
    const launchReceipt =
      'Async agent launched successfully. (This tool result is internal metadata — never quote it.) agentId: internal-1 output_file: C:\\temp\\agent.output'
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'flow-1',
        toolName: 'Agent',
        state: 'output-available',
        input: { prompt: 'Inspect the renderer' },
        output: launchReceipt
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'success' } }] as CherryUIMessage[]

    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <OpenFlowButton agentName="general-purpose" />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    await user.click(screen.getByRole('button', { name: 'open flow' }))
    const receiptTrigger = screen.getByRole('button', { name: 'agent.right_pane.flow.launch_receipt' })
    expect(receiptTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(launchReceipt)).not.toBeInTheDocument()

    await user.click(receiptTrigger)
    expect(screen.getByText(launchReceipt)).toBeInTheDocument()
  })

  it('keeps the foreground completion receipt collapsed below the child message flow', async () => {
    const user = userEvent.setup()
    const completionReceipt =
      "agentId: af624763698eaaff3 (use SendMessage with to: 'af624763698eaaff3', summary: '<5-10 word recap>' to continue this agent) subagent_tokens: 27371 tool_uses: 16 duration_ms: 56581"
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'flow-1',
        toolName: 'Agent',
        state: 'output-available',
        input: { prompt: 'Inspect the renderer' },
        output: `Inspection complete\n\n${completionReceipt}`
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'success' } }] as CherryUIMessage[]

    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <OpenFlowButton agentName="general-purpose" />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    await user.click(screen.getByRole('button', { name: 'open flow' }))
    const receiptTrigger = screen.getByRole('button', { name: 'agent.right_pane.flow.completion_receipt' })
    expect(receiptTrigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(completionReceipt)).not.toBeInTheDocument()

    await user.click(receiptTrigger)
    expect(screen.getByText(completionReceipt)).toBeInTheDocument()
  })

  it('shows a dsh todo_write snapshot in the floating task capsule', () => {
    const todoPart = {
      type: 'dynamic-tool',
      toolCallId: 'dsh-todos-1',
      toolName: 'todo_write',
      state: 'output-available',
      input: {
        todos: [
          { content: 'Connect the task list', status: 'completed' },
          { content: 'Verify the right pane', status: 'in_progress' }
        ]
      },
      callProviderMetadata: {
        cherry: { transport: 'dsh-agent', tool: { type: 'builtin', name: 'todo_write' } }
      }
    } as unknown as CherryMessagePart
    const messages = [
      { id: 'm1', role: 'assistant', parts: [todoPart], metadata: { status: 'success' } }
    ] as CherryUIMessage[]

    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: [todoPart] }}>
        <AgentTaskProgressCapsule />
      </TestAgentRightPane>
    )

    const details = screen.getByTestId('agent-task-progress-details')
    expect(within(details).getByText('Connect the task list')).toHaveClass('text-muted-foreground')
    expect(within(details).getByText('Verify the right pane')).toBeInTheDocument()
  })

  it('uses the Workflow summary layout before phases are reported', () => {
    renderStatusTasks([
      {
        id: 'workflow-starting',
        status: 'in_progress',
        title: 'Starting workflow',
        description: 'Coordinate specialist agents',
        taskType: 'local_workflow',
        workflowName: 'start-review'
      }
    ])

    expect(screen.getByText('start-review')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.agent_count·agent.right_pane.status.workflow')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.workflow_state.running')).toBeInTheDocument()
    expect(screen.getByText('Coordinate specialist agents')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.total·-')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.context_size·-')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.tools·-')).toBeInTheDocument()
  })

  it('renders every Workflow phase separately without a root FlowTab fallback and keeps details after completion', async () => {
    const user = userEvent.setup()
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'workflow-1',
          toolUseId: 'workflow-tool',
          status: 'in_progress',
          title: 'Review PR',
          description: 'Review the pull request with specialist agents',
          taskType: 'local_workflow',
          workflowName: 'review-pr',
          createdAt: '2026-08-12T01:00:00.000Z',
          usage: { totalTokens: 2400, toolUses: 7, durationMs: 15_000 },
          workflow: {
            runId: 'run-1',
            taskId: 'workflow-1',
            workflowName: 'review-pr',
            totalTokens: 2000,
            totalCumulativeTokens: 5600,
            phases: [{ title: 'Inspect renderer files with a deliberately long phase name' }],
            workflowProgress: [
              {
                type: 'workflow_phase',
                index: 1,
                title: 'Inspect renderer files with a deliberately long phase name'
              },
              {
                type: 'workflow_agent',
                index: 1,
                label: 'Inspect:renderer-with-a-deliberately-long-agent-name-that-must-wrap',
                phaseIndex: 1,
                phaseTitle: 'Inspect renderer files with a deliberately long phase name',
                state: 'running',
                tokens: 1200,
                cumulativeTokens: 3200,
                toolCalls: 4,
                durationMs: 80_000
              },
              {
                type: 'workflow_agent',
                index: 2,
                label: 'Inspect:tests',
                phaseIndex: 1,
                phaseTitle: 'Inspect renderer files with a deliberately long phase name',
                state: 'done',
                tokens: 800,
                cumulativeTokens: 2400,
                toolCalls: 2,
                durationMs: 5000
              }
            ]
          }
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]

    const view = render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    await user.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    expect(screen.getByRole('region', { name: 'agent.right_pane.status.running' })).toBeInTheDocument()
    expect(screen.getByText('review-pr')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.total·5.6K')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.context_size·2K')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.tools·7')).toBeInTheDocument()
    const workflowButton = screen.getByRole('button', {
      name: 'agent.right_pane.status.toggle_workflow'
    })
    expect(workflowButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(workflowButton).getByText('review-pr')).toBeInTheDocument()
    expect(
      within(workflowButton).getByText('agent.right_pane.status.agent_count·agent.right_pane.status.workflow')
    ).toBeInTheDocument()
    expect(within(workflowButton).getByText('agent.right_pane.status.workflow_state.running')).toBeInTheDocument()
    const workflowDescription = within(workflowButton).getByText('Review the pull request with specialist agents')
    expect(workflowDescription).toBeInTheDocument()
    const phaseTitle = 'Inspect renderer files with a deliberately long phase name'
    expect(screen.getByRole('button', { name: phaseTitle })).toBeInTheDocument()

    await user.click(workflowDescription)
    expect(workflowButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: phaseTitle })).not.toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.total·5.6K')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.context_size·2K')).toBeInTheDocument()

    await user.click(workflowButton)
    const phaseButton = screen.getByRole('button', { name: phaseTitle })
    expect(phaseButton).toBeInTheDocument()
    expect(phaseButton).toHaveAttribute('aria-label', phaseTitle)
    expect(phaseButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTitle(phaseTitle)).toBeInTheDocument()
    const summarySquares = within(phaseButton).getAllByRole('img')
    expect(summarySquares.map((square) => square.getAttribute('aria-label'))).toEqual([
      'Inspect:renderer-with-a-deliberately-long-agent-name-that-must-wrap · agent.right_pane.status.workflow_state.running',
      'Inspect:tests · agent.right_pane.status.workflow_state.completed'
    ])
    // The user explicitly requires solid status-square colors to match each workflow state.
    expect(summarySquares[0]).toHaveClass('size-2.5', 'rounded-xs', 'bg-info')
    expect(summarySquares[1]).toHaveClass('size-2.5', 'rounded-xs', 'bg-muted-foreground')
    expect(
      within(phaseButton).queryByText('Inspect:renderer-with-a-deliberately-long-agent-name-that-must-wrap')
    ).not.toBeInTheDocument()
    expect(within(phaseButton).queryByText('Inspect:tests')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.right_pane.status.agent')).not.toBeInTheDocument()

    await user.click(phaseButton)

    expect(phaseButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('agent.right_pane.status.agent')).toBeInTheDocument()
    expect(screen.getAllByText('agent.right_pane.status.total')).toHaveLength(1)
    expect(screen.getByText('agent.right_pane.status.context_size')).toBeInTheDocument()
    expect(screen.getByText('agent.right_pane.status.tools')).toBeInTheDocument()
    // This class is the contract for the observed long-duration wrapping regression.
    expect(screen.getByRole('columnheader', { name: 'agent.right_pane.status.time' })).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '1m 20s' })).toHaveClass('whitespace-nowrap')
    const tableRows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(within(tableRows[0]).getByText('3.2K')).toBeInTheDocument()
    expect(within(tableRows[0]).getByText('1.2K')).toBeInTheDocument()
    expect(within(tableRows[1]).getByText('2.4K')).toBeInTheDocument()
    expect(within(tableRows[1]).getByText('800')).toBeInTheDocument()
    const agentName = 'Inspect:renderer-with-a-deliberately-long-agent-name-that-must-wrap'
    const agentNameButton = within(tableRows[0]).getByRole('button', {
      name: 'agent.right_pane.status.copy_agent_name'
    })
    expect(
      within(tableRows[1]).getByRole('button', {
        name: 'agent.right_pane.status.copy_agent_name'
      })
    ).toBeInTheDocument()
    expect(agentNameButton).toHaveAttribute('title', agentName)
    expect(within(agentNameButton).getByText(agentName)).toBeInTheDocument()
    const clipboardWriteText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await user.click(agentNameButton)
    expect(clipboardWriteText).toHaveBeenCalledExactlyOnceWith(agentName)
    clipboardWriteText.mockRestore()

    await user.click(phaseButton)
    expect(phaseButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('agent.right_pane.status.agent')).not.toBeInTheDocument()

    taskEventsState.events = {
      'workflow-1': {
        event: 'notification',
        taskId: 'workflow-1',
        status: 'completed',
        title: 'Review PR',
        completedAt: '2026-08-12T01:01:00.000Z'
      }
    }
    view.rerender(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByRole('region', { name: 'agent.right_pane.status.running' })).not.toBeInTheDocument()
    const completed = screen.getByRole('region', { name: 'agent.right_pane.status.completed' })
    const completedPhaseButton = within(completed).getByRole('button', { name: phaseTitle })
    expect(completedPhaseButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(completedPhaseButton)
    expect(within(completed).getByRole('table')).toBeInTheDocument()
  })

  it('keeps running Workflow and Agent durations moving between SDK progress events', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime('2026-08-12T01:00:10.000Z')
      const parts = [
        {
          type: 'data-agent-task-event',
          data: {
            event: 'started',
            taskId: 'workflow-live-time',
            status: 'in_progress',
            title: 'Live workflow time',
            taskType: 'local_workflow',
            createdAt: '2026-08-12T01:00:00.000Z',
            workflow: {
              runId: 'run-live-time',
              taskId: 'workflow-live-time',
              phases: [{ title: 'Inspect' }],
              workflowProgress: [
                { type: 'workflow_phase', index: 1, title: 'Inspect' },
                {
                  type: 'workflow_agent',
                  index: 1,
                  label: 'Inspect:runtime',
                  phaseIndex: 1,
                  phaseTitle: 'Inspect',
                  state: 'running',
                  startedAt: Date.parse('2026-08-12T01:00:09.000Z')
                }
              ]
            }
          }
        }
      ] as unknown as CherryMessagePart[]
      const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]
      render(
        <TestAgentRightPane
          sessionId="session-a"
          workspacePath="/workspace"
          messages={messages}
          partsByMessageId={{ m1: parts }}>
          <AgentRightPane.Shortcuts />
          <AgentRightPane.Viewport />
        </TestAgentRightPane>
      )
      fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

      const workflowButton = screen.getByRole('button', {
        name: 'agent.right_pane.status.toggle_workflow'
      })
      expect(within(workflowButton).getByText('10s')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
      expect(screen.getByText('1s')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByText('12s')).toBeInTheDocument()
      expect(screen.getByText('3s')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.files' }))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps same-title Workflow phases separate by their declared order', async () => {
    const user = userEvent.setup()
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'workflow-duplicate-phases',
          status: 'in_progress',
          title: 'Review duplicate phases',
          taskType: 'local_workflow',
          workflowName: 'duplicate-phases',
          workflow: {
            runId: 'run-duplicate-phases',
            taskId: 'workflow-duplicate-phases',
            workflowName: 'duplicate-phases',
            phases: [{ title: 'Review' }, { title: 'Review' }],
            workflowProgress: [
              {
                type: 'workflow_agent',
                index: 1,
                label: 'second-phase-agent',
                phaseIndex: 2,
                phaseTitle: 'Review',
                state: 'running'
              }
            ]
          }
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]

    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    await user.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    const phaseButtons = screen.getAllByRole('button', { name: 'Review' })
    expect(phaseButtons).toHaveLength(2)
    expect(
      within(phaseButtons[0]).queryByRole('img', {
        name: 'second-phase-agent · agent.right_pane.status.workflow_state.running'
      })
    ).not.toBeInTheDocument()
    expect(
      within(phaseButtons[1]).getByRole('img', {
        name: 'second-phase-agent · agent.right_pane.status.workflow_state.running'
      })
    ).toBeInTheDocument()
  })

  it('moves a detached task from running to completed when authoritative membership is removed', async () => {
    const user = userEvent.setup()
    backgroundTasksState.tasks = [
      { id: 'shell-1', type: 'local_bash', description: 'Start development server', toolCallId: 'bash-1' }
    ]
    taskEventsState.events = {
      'shell-1': {
        event: 'updated',
        taskId: 'shell-1',
        status: 'in_progress',
        isBackgrounded: true
      }
    }
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'shell-1',
          status: 'in_progress',
          title: 'Start development server',
          taskType: 'local_bash'
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'success' } }] as CherryUIMessage[]

    const view = render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    await user.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    expect(
      within(screen.getByRole('region', { name: 'agent.right_pane.status.running' })).getByText(
        /Start development server/
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'agent.right_pane.status.completed' })).not.toBeInTheDocument()

    backgroundTasksState.tasks = []
    view.rerender(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByRole('region', { name: 'agent.right_pane.status.running' })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'agent.right_pane.status.completed' })).getByText(
        /Start development server/
      )
    ).toBeInTheDocument()
  })

  it('keeps activity sections collapsible and sorts the newest completed work first', async () => {
    const user = userEvent.setup()
    backgroundTasksState.tasks = [
      { id: 'aggregate-shell', type: 'local_bash', description: 'Aggregate-only shell', toolCallId: 'bash-aggregate' }
    ]
    const events = [
      {
        event: 'started',
        taskId: 'shell-running',
        status: 'in_progress',
        title: 'Later shell',
        taskType: 'local_bash',
        createdAt: '2026-08-12T01:02:00.000Z'
      },
      {
        event: 'started',
        taskId: 'workflow-later',
        status: 'in_progress',
        title: 'Later workflow',
        taskType: 'local_workflow',
        createdAt: '2026-08-12T01:03:00.000Z'
      },
      {
        event: 'started',
        taskId: 'shell-legacy',
        status: 'in_progress',
        title: 'Legacy shell',
        taskType: 'local_bash'
      },
      {
        event: 'started',
        taskId: 'workflow-earlier',
        status: 'in_progress',
        title: 'Earlier workflow',
        taskType: 'local_workflow',
        createdAt: '2026-08-12T01:01:00.000Z'
      },
      {
        event: 'started',
        taskId: 'workflow-legacy',
        status: 'in_progress',
        title: 'Legacy workflow',
        taskType: 'local_workflow'
      },
      {
        event: 'notification',
        taskId: 'agent-completed-later',
        status: 'completed',
        title: 'Later completed agent',
        taskType: 'local_agent',
        createdAt: '2026-08-12T01:00:00.000Z',
        completedAt: '2026-08-12T01:05:00.000Z'
      },
      {
        event: 'notification',
        taskId: 'shell-completed-earlier',
        status: 'completed',
        title: 'Earlier completed shell',
        taskType: 'local_bash',
        createdAt: '2026-08-12T01:04:00.000Z',
        completedAt: '2026-08-12T01:04:30.000Z'
      },
      {
        event: 'notification',
        taskId: 'agent-completed-legacy',
        status: 'completed',
        title: 'Legacy completed agent',
        taskType: 'local_agent'
      }
    ]
    const parts = events.map((data) => ({ type: 'data-agent-task-event', data }) as unknown as CherryMessagePart)
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]

    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    await user.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    const running = screen.getByRole('region', { name: 'agent.right_pane.status.running' })
    const runningToggle = within(running).getByRole('button', { name: /agent\.right_pane\.status\.running/ })
    expect(runningToggle).toHaveAttribute('aria-expanded', 'true')
    const runningTitles = within(running)
      .getAllByTestId('agent-run-task-title')
      .map((node) => node.textContent)
    expect(runningTitles).toEqual([
      'Earlier workflow',
      'Later workflow',
      'Legacy workflow',
      'Later shell',
      'Legacy shell',
      'Aggregate-only shell'
    ])

    const completed = screen.getByRole('region', { name: 'agent.right_pane.status.completed' })
    const completedToggle = within(completed).getByRole('button', { name: /agent\.right_pane\.status\.completed/ })
    expect(completedToggle).toHaveAttribute('aria-expanded', 'true')
    const completedTitles = within(completed)
      .getAllByTestId('agent-run-task-title')
      .map((node) => node.textContent)
    expect(completedTitles).toEqual(['Later completed agent', 'Earlier completed shell', 'Legacy completed agent'])

    await user.click(runningToggle)
    expect(runningToggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(running).queryByTestId('agent-run-task-title')).not.toBeInTheDocument()
    expect(within(completed).getAllByTestId('agent-run-task-title')).toHaveLength(3)

    await user.click(completedToggle)
    expect(completedToggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(completed).queryByTestId('agent-run-task-title')).not.toBeInTheDocument()
  })

  it('shows a live background command duration and copies the command with all output', async () => {
    vi.useFakeTimers()
    const clipboardWriteText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    try {
      vi.setSystemTime('2026-08-12T01:00:10.000Z')
      const parts = [
        {
          type: 'dynamic-tool',
          toolCallId: 'bash-live',
          toolName: 'Bash',
          state: 'output-available',
          input: { command: 'pnpm dev' },
          output: 'ready on http://localhost:5173'
        },
        {
          type: 'data-agent-task-event',
          data: {
            event: 'started',
            taskId: 'shell-live',
            toolUseId: 'bash-live',
            taskType: 'local_bash',
            status: 'in_progress',
            title: 'Start development server',
            createdAt: '2026-08-12T01:00:00.000Z'
          }
        }
      ] as unknown as CherryMessagePart[]
      const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]

      render(
        <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
          <AgentRightPane.Shortcuts />
          <AgentRightPane.Viewport />
        </TestAgentRightPane>
      )
      // userEvent timer advancement loops on the live interval; keep this fake-clock test deterministic.
      fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

      const commandButton = screen.getByRole('button', {
        name: /agent\.right_pane\.status\.background_command.*Start development server/
      })
      expect(within(commandButton).getByTestId('agent-run-task-title')).toHaveTextContent('Start development server')
      expect(within(commandButton).getByText('local_bash')).toBeInTheDocument()
      expect(within(commandButton).queryByText('> pnpm dev')).not.toBeInTheDocument()
      expect(within(commandButton).getByText('10s')).toBeInTheDocument()

      await act(async () => vi.advanceTimersByTime(2000))
      expect(within(commandButton).getByText('12s')).toBeInTheDocument()

      fireEvent.click(commandButton)
      expect(screen.getByText('ready on http://localhost:5173')).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.status.copy_all' }))
        await Promise.resolve()
      })
      expect(clipboardWriteText).toHaveBeenCalledExactlyOnceWith('> pnpm dev\n\nready on http://localhost:5173')
    } finally {
      clipboardWriteText.mockRestore()
      vi.useRealTimers()
    }
  })

  it('keeps a background command collapsed and refreshes deferred output from Flow part versions', async () => {
    const user = userEvent.setup()
    const createParts = (output: unknown, status: 'in_progress' | 'completed' = 'in_progress') =>
      [
        {
          type: 'dynamic-tool',
          toolCallId: 'bash-1',
          toolName: 'Bash',
          state: 'output-available',
          input: { command: 'pnpm dev' },
          output
        },
        {
          type: 'data-agent-task-event',
          data: {
            event: status === 'completed' ? 'notification' : 'started',
            taskId: 'shell-1',
            toolUseId: 'bash-1',
            taskType: 'local_bash',
            status,
            title: 'Start development server',
            createdAt: '2026-08-12T01:00:00.000Z'
          }
        }
      ] as unknown as CherryMessagePart[]
    const renderPane = (currentParts: CherryMessagePart[]) => {
      const currentMessages = [
        { id: 'm1', role: 'assistant', parts: currentParts, metadata: { status: 'pending' } }
      ] as CherryUIMessage[]
      return (
        <TestAgentRightPane sessionId="session-a" messages={currentMessages} partsByMessageId={{ m1: currentParts }}>
          <AgentRightPane.Shortcuts />
          <AgentRightPane.Viewport />
        </TestAgentRightPane>
      )
    }
    const parts = createParts('ready on http://localhost:5173')

    const view = render(renderPane(parts))
    await user.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    const commandButton = screen.getByRole('button', { name: /Start development server/ })
    expect(commandButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTitle('Start development server')).toHaveClass('truncate')
    expect(screen.queryByText('> pnpm dev')).not.toBeInTheDocument()
    expect(screen.queryByText(/ready on http:\/\/localhost:5173/)).not.toBeInTheDocument()

    await user.click(commandButton)
    expect(commandButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('> pnpm dev')).toBeInTheDocument()
    expect(screen.getByText(/ready on http:\/\/localhost:5173/)).toBeInTheDocument()

    const updatedParts = createParts('ready on http://localhost:5173\nrebuilt renderer')
    view.rerender(renderPane(updatedParts))
    expect(screen.getByText(/rebuilt renderer/)).toBeInTheDocument()

    const deferredRef = { topicId: 'agent-session:session-a', messageId: 'm1', toolCallId: 'bash-1' }
    const initialDeferredOutput = {
      $deferredToolResult: deferredRef,
      excerpt: {
        head: 'ready on http://localhost:5173',
        tail: 'first deferred snapshot',
        totalChars: 50_000,
        totalLines: 2_000
      }
    }
    toolResultState.output = {
      stdout: 'ready on http://localhost:5173\nrebuilt renderer\nfirst deferred snapshot',
      stderr: 'warning: fixture',
      interrupted: false,
      backgroundTaskId: 'shell-1'
    }
    view.rerender(renderPane(createParts(initialDeferredOutput)))

    expect(await screen.findByText(/first deferred snapshot/)).toBeInTheDocument()
    expect(screen.getByText(/warning: fixture/)).toBeInTheDocument()

    const appendedDeferredOutput = {
      ...initialDeferredOutput,
      excerpt: {
        ...initialDeferredOutput.excerpt,
        tail: 'output appended after excerpt update',
        totalChars: 50_040,
        totalLines: 2_001
      }
    }
    toolResultState.output = { stdout: 'output appended after excerpt update' }
    view.rerender(renderPane(createParts(appendedDeferredOutput)))
    expect(await screen.findByText(/output appended after excerpt update/)).toBeInTheDocument()

    toolResultState.output = { stdout: 'final output after completion' }
    view.rerender(renderPane(createParts(appendedDeferredOutput, 'completed')))

    const completed = screen.getByRole('region', { name: 'agent.right_pane.status.completed' })
    const completedCommandButton = within(completed).getByRole('button', { name: /Start development server/ })
    await user.click(completedCommandButton)
    expect(await screen.findByText(/final output after completion/)).toBeInTheDocument()
  })

  it('loads a completed shell deferred output only after the user expands it', async () => {
    const user = userEvent.setup()
    const deferredRef = { topicId: 'agent-session:session-a', messageId: 'm1', toolCallId: 'bash-1' }
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'bash-1',
        toolName: 'Bash',
        state: 'output-available',
        input: { command: 'pnpm build' },
        output: {
          $deferredToolResult: deferredRef,
          excerpt: { head: 'build started', tail: 'build completed', totalChars: 50_000, totalLines: 2_000 }
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'shell-1',
          toolUseId: 'bash-1',
          taskType: 'local_bash',
          status: 'completed',
          title: 'Build application'
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'success' } }] as CherryUIMessage[]

    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    await user.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    const commandButton = screen.getByRole('button', { name: /Build application/ })
    expect(commandButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/build started/)).not.toBeInTheDocument()
    expect(ipcRequestMock.mock.calls.filter(([channel]) => channel === 'ai.tool.get_result')).toHaveLength(0)

    toolResultState.output = 'complete build output'
    await user.click(commandButton)

    expect(commandButton).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText(/complete build output/)).toBeInTheDocument()
    expect(ipcRequestMock.mock.calls.filter(([channel]) => channel === 'ai.tool.get_result')).toHaveLength(1)

    await user.click(commandButton)
    expect(commandButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/complete build output/)).not.toBeInTheDocument()
  })

  it('keeps declared artifacts ahead of run sections', () => {
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'artifacts-1',
        toolName: 'report_artifacts',
        state: 'output-available',
        input: { artifacts: [{ path: 'docs/index.html' }] }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'notification',
          taskId: 'shell-1',
          taskType: 'shell',
          status: 'in_progress',
          title: 'Screenshot each page'
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]

    render(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        messages={messages}
        partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    const sectionOrder = [
      screen.getByText('agent.right_pane.info.artifacts'),
      screen.getByTestId('context-usage'),
      screen.getByRole('region', { name: 'agent.right_pane.status.running' })
    ]

    for (const [index, node] of sectionOrder.slice(0, -1).entries()) {
      expect(node.compareDocumentPosition(sectionOrder[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getByText('index.html')).toBeInTheDocument()
  })

  it('hides the artifacts section when the workspace cannot open files', () => {
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'artifacts-1',
        toolName: 'report_artifacts',
        state: 'output-available',
        input: { artifacts: [{ path: 'docs/index.html' }] }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [{ id: 'm1', role: 'assistant', parts, metadata: { status: 'pending' } }] as CherryUIMessage[]

    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    expect(screen.queryByText('agent.right_pane.info.artifacts')).toBeNull()
  })

  it('restores the stop button and reports an error when the runtime cannot stop the task', async () => {
    ipcRequestMock.mockResolvedValue(false)
    renderStatusTasks([{ id: 'subagent-1', status: 'in_progress', title: 'Inspect task state' }])

    const stopButton = screen.getByRole('button', { name: 'agent.right_pane.status.stop_run_task' })
    fireEvent.click(stopButton)

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('agent.right_pane.status.stop_run_task_failed'))
    expect(stopButton).toBeEnabled()
  })

  it('does not mount the files capability while the shell is closed', () => {
    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(useArtifactFileTreeModelMock).not.toHaveBeenCalled()
  })

  it('does not mount the files capability when opening a status panel', () => {
    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(useArtifactFileTreeModelMock).not.toHaveBeenCalled()
  })

  it('loads trace on demand and unmounts it while inactive to release its retained tree', async () => {
    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(tracePaneModuleLoadMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'trace.label' }))
    const tracePane = await screen.findByTestId('trace-pane')
    expect(tracePaneModuleLoadMock).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.files' }))
    expect(screen.queryByTestId('trace-pane')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'trace.label' }))
    expect(await screen.findByTestId('trace-pane')).not.toBe(tracePane)
  })

  it('keeps a visited files instance through pending and removes it when unavailable', () => {
    const { rerender } = render(
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')

    rerender(
      <TestAgentRightPane
        conversationState="pending"
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')

    rerender(
      <TestAgentRightPane
        conversationState="unavailable"
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.queryByTestId('artifact-pane')).toBeNull()
  })

  it('does not re-render the active files capability when only runtime messages change', () => {
    const { rerender } = render(
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    const callsAfterMount = useArtifactFileTreeModelMock.mock.calls.length
    const messages = [{ id: 'm1', role: 'user', parts: [], metadata: {} }] as CherryUIMessage[]

    rerender(
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={messages}
        partsByMessageId={{ m1: [] }}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(useArtifactFileTreeModelMock).toHaveBeenCalledTimes(callsAfterMount)
  })

  it('clears the overlay preview when the selected file disappears from the tree model', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([['README.md', { kind: 'file' }]])

    render(
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))

    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md')

    act(() => {
      fileTreeModelState.nodeById = new Map()
      fileTreeModelStore.revision += 1
      fileTreeModelStore.listeners.forEach((listener) => listener())
    })

    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', '')
  })

  it('keeps an unindexed selection after a previously indexed file was selectable', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([['README.md', { kind: 'file' }]])

    render(
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md')

    fireEvent.click(screen.getByRole('button', { name: 'select src/deep.ts' }))

    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('src/deep.ts')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'src/deep.ts')
  })

  it('switches files directly when the current file is clean', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([
      ['README.md', { kind: 'file' }],
      ['src/deep.ts', { kind: 'file' }]
    ])
    const renderPane = () => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    render(renderPane())

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md')

    fireEvent.click(screen.getByRole('button', { name: 'select src/deep.ts' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('src/deep.ts')
  })

  it('registers the dirty-navigation guard for navigation owned outside the pane', () => {
    const onFileNavigationRequestChange = vi.fn()
    const renderPane = () => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}
        onFileNavigationRequestChange={onFileNavigationRequestChange}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    const { rerender } = render(renderPane())
    fileSessionState.isDirty = true
    rerender(renderPane())
    const requestNavigation = onFileNavigationRequestChange.mock.calls
      .map(([request]) => request)
      .filter(Boolean)
      .at(-1) as ((transition: () => void) => void) | undefined
    const transition = vi.fn()

    act(() => requestNavigation?.(transition))

    expect(transition).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('agent.preview_pane.edit.leave.title')
  })

  it('keeps the current dirty file when navigation is cancelled', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([
      ['README.md', { kind: 'file' }],
      ['src/deep.ts', { kind: 'file' }]
    ])
    const renderPane = () => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    const { rerender } = render(renderPane())

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    fileSessionState.isDirty = true
    rerender(renderPane())

    fireEvent.click(screen.getByRole('button', { name: 'select src/deep.ts' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('agent.preview_pane.edit.leave.title')
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'README.md')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-edit-mode', 'edit')
    expect(fileSessionDiscardMock).not.toHaveBeenCalled()
  })

  it('discards the dirty draft before confirming navigation', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([
      ['README.md', { kind: 'file' }],
      ['src/deep.ts', { kind: 'file' }]
    ])
    const renderPane = () => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    const { rerender } = render(renderPane())

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    fileSessionState.isDirty = true
    rerender(renderPane())
    fileSessionDiscardMock.mockImplementationOnce(() => {
      expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md')
    })

    fireEvent.click(screen.getByRole('button', { name: 'select src/deep.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.edit.leave.discard_and_continue' }))

    expect(fileSessionDiscardMock).toHaveBeenCalledOnce()
    expect(fileSessionFlushMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('src/deep.ts')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'src/deep.ts')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-edit-mode', 'preview')
  })

  it('keeps the dirty file bound to its original workspace until the workspace transition is confirmed', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([['README.md', { kind: 'file' }]])
    const renderPane = (workspacePath: string) => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath={workspacePath}
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    const { rerender } = render(renderPane('/workspace-a'))

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    fileSessionState.isDirty = true
    rerender(renderPane('/workspace-b'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(useArtifactFileTreeModelMock.mock.calls.at(-1)?.[0]).toMatchObject({ workspacePath: '/workspace-a' })

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.edit.leave.discard_and_continue' }))

    expect(fileSessionDiscardMock).toHaveBeenCalledOnce()
    expect(useArtifactFileTreeModelMock.mock.calls.at(-1)?.[0]).toMatchObject({ workspacePath: '/workspace-b' })
    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
  })

  it('waits for an in-flight save before allowing discard and navigation', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([
      ['README.md', { kind: 'file' }],
      ['src/deep.ts', { kind: 'file' }]
    ])
    const renderPane = () => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    const { rerender } = render(renderPane())

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    fileSessionState.isDirty = true
    fileSessionState.isSaving = true
    rerender(renderPane())
    fireEvent.click(screen.getByRole('button', { name: 'select src/deep.ts' }))

    const confirm = screen.getByRole('button', { name: 'agent.preview_pane.edit.leave.discard_and_continue' })
    expect(confirm).toBeDisabled()
    expect(fileSessionDiscardMock).not.toHaveBeenCalled()

    fileSessionState.isSaving = false
    rerender(renderPane())
    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.edit.leave.discard_and_continue' }))

    expect(fileSessionDiscardMock).toHaveBeenCalledOnce()
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('src/deep.ts')
  })

  it('closes a clean preview directly without a leave prompt', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([['README.md', { kind: 'file' }]])
    const renderPane = () => (
      <TestAgentRightPane
        defaultOpen
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )
    render(renderPane())

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
  })
})
