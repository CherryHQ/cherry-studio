import {
  HoverCard as RealHoverCard,
  HoverCardContent as RealHoverCardContent,
  HoverCardTrigger as RealHoverCardTrigger
} from '@cherrystudio/ui/components'
import type * as ArtifactPanePath from '@renderer/components/chat/panes/artifactPanePath'
import { useRightPanelState } from '@renderer/components/chat/panes/Shell'
import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import type { AgentSessionBackgroundTask } from '@shared/ai/agentSessionBackgroundTasks'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { AbsoluteFilePath, PhysicalFileMetadata } from '@shared/types/file'
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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AgentRightPaneProjection from '../agentRightPaneProjection'

const {
  backgroundTasksState,
  buildAgentToolFlowProjectionMock,
  getToolResultMock,
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
  uiMockState
} = vi.hoisted(() => ({
  backgroundTasksState: { value: [] as AgentSessionBackgroundTask[] },
  buildAgentToolFlowProjectionMock: vi.fn(),
  getToolResultMock: vi.fn(),
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
  uiMockState: { useRealHoverCard: false }
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

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children }: PropsWithChildren) => <span>{children}</span>,
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
  MessageListProvider: ({
    children,
    value
  }: PropsWithChildren<{
    value: { state: { renderConfig: { collapseCompletedToolHistory: boolean; messageStyle: string } } }
  }>) => (
    <div
      data-testid="message-list-provider"
      data-collapse-completed-tool-history={String(value.state.renderConfig.collapseCompletedToolHistory)}
      data-message-style={value.state.renderConfig.messageStyle}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/hooks/useToolResult', () => ({
  useToolResult: (ref: unknown) => ({ output: ref ? getToolResultMock(ref) : undefined })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastErrorMock }
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
    previewFileSelection?: {
      workspacePath: string
      filePath: string
      displayName?: string
      displayPath?: string
      previewType?: string
      readOnly?: boolean
    } | null
    selectedFile: string | null
  }) => (
    <div
      data-testid="artifact-pane"
      data-display-path={previewFileSelection?.displayPath ?? ''}
      data-edit-mode={editMode}
      data-preview-path={
        previewFileSelection ? `${previewFileSelection.workspacePath}/${previewFileSelection.filePath}` : ''
      }
      data-preview-type={previewFileSelection?.previewType ?? ''}
      data-read-only={String(previewFileSelection?.readOnly ?? false)}
      data-selected-file={selectedFile ?? ''}>
      {headerVariant === 'pane' ? (
        <div data-testid="artifact-pane-header">
          {previewFileSelection ? (
            <button type="button" aria-label="common.back" onClick={onPreviewClose}>
              back
            </button>
          ) : null}
          <span data-testid="artifact-pane-header-title">
            {previewFileSelection?.displayName ?? previewFileSelection?.filePath ?? paneTitle}
          </span>
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
          {previewFileSelection.displayName ?? previewFileSelection.filePath}
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

vi.mock('@renderer/components/OpenTarget', () => ({
  OpenTargetButton: () => <button type="button">Open external</button>,
  loadOpenTargetMenuItems: vi.fn(async () => [])
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
  useAgentSessionBackgroundTasks: () => backgroundTasksState.value
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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT })
}))

import { AgentRightPane, AgentTaskProgressCapsule, useAgentRightPaneActions } from '../AgentRightPane'

type TestAgentRightPaneProps = ComponentProps<typeof AgentRightPane.Scope>

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
    <AgentRightPane.Scope
      {...scopeProps}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      resourcePane={resourcePane}>
      {children}
    </AgentRightPane.Scope>
  )
}

function OpenFlowButton({
  label = 'open flow',
  title = 'Inspect flow',
  toolCallId = 'flow-1'
}: {
  label?: string
  title?: string
  toolCallId?: string
}) {
  const { openAgentToolFlow } = useAgentRightPaneActions()

  return (
    <button type="button" onClick={() => openAgentToolFlow({ toolCallId, toolName: 'task', title })}>
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

function OpenInputFilePreviewButton({
  displayName = 'report.md',
  label = 'open input preview',
  mediaType = 'text/markdown',
  originalPath = '/Users/alice/report.md' as AbsoluteFilePath,
  previewPath = '/internal/message-files/report.md' as AbsoluteFilePath
}: {
  displayName?: string
  label?: string
  mediaType?: string
  originalPath?: AbsoluteFilePath
  previewPath?: AbsoluteFilePath
}) {
  const { canPreviewInputFileInRightPane, previewInputFileInRightPane } = useAgentRightPaneActions()
  return (
    <>
      <output data-testid="can-preview-input-file">{String(canPreviewInputFileInRightPane)}</output>
      <button
        type="button"
        disabled={!canPreviewInputFileInRightPane}
        onClick={() =>
          previewInputFileInRightPane({
            displayName,
            previewPath,
            originalPath,
            mediaType
          })
        }>
        {label}
      </button>
    </>
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
  toolUseId?: string
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
          toolUseId: task.toolUseId
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
    ipcRequestMock.mockResolvedValue({
      kind: 'file',
      type: 'text',
      size: 1,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/plain'
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
    systemFileTreeState.version = 0
    backgroundTasksState.value = []
    useDirectoryTreeMock.mockImplementation(() => systemFileTreeState)
    useArtifactFileTreeModelMock.mockImplementation(() => ({
      hasLoaded: fileTreeModelState.hasLoaded,
      nodeById: fileTreeModelState.nodeById
    }))
    getToolResultMock.mockReturnValue('Loaded flow result')
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

    await waitFor(() => expect(getToolResultMock).toHaveBeenCalledWith(deferredToolResult))
    await waitFor(() =>
      expect(buildAgentToolFlowProjectionMock).toHaveBeenLastCalledWith(
        messages,
        { m1: [flowPart] },
        'flow-1',
        'Loaded flow result'
      )
    )
  })

  it('presents flow prompts as bubbles and keeps completed process history collapsed', () => {
    const flowPart = {
      type: 'dynamic-tool',
      toolCallId: 'flow-1',
      toolName: 'Agent',
      state: 'output-available',
      input: { prompt: 'Inspect the workspace' },
      output: 'Inspection complete'
    } as unknown as CherryMessagePart
    const messages = [{ id: 'm1', role: 'assistant', parts: [flowPart], metadata: {} }] as CherryUIMessage[]

    render(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        messages={messages}
        partsByMessageId={{ m1: [flowPart] }}>
        <OpenFlowButton />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open flow' }))

    expect(screen.getByTestId('message-list-provider')).toHaveAttribute('data-collapse-completed-tool-history', 'true')
    expect(screen.getByTestId('message-list-provider')).toHaveAttribute('data-message-style', 'bubble')
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

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('opens sent input files as read-only previews while displaying the original path', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      kind: 'file',
      type: 'text',
      size: 1,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/markdown'
    })

    render(
      <TestAgentRightPane sessionId="session-a" messages={[]} partsByMessageId={{}}>
        <OpenInputFilePreviewButton />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    expect(screen.getByTestId('can-preview-input-file')).toHaveTextContent('true')
    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('report.md')
    })
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-read-only', 'true')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-preview-type', 'file')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-edit-mode', 'preview')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-display-path', '/Users/alice/report.md')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
      'data-preview-path',
      '/internal/message-files/report.md'
    )
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', '')
    expect(ipcRequestMock).toHaveBeenNthCalledWith(1, 'file.get_metadata', {
      kind: 'path',
      path: '/Users/alice/report.md'
    })
    expect(ipcRequestMock).toHaveBeenNthCalledWith(2, 'file.get_metadata', {
      kind: 'path',
      path: '/internal/message-files/report.md'
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
  })

  it('uses the managed copy when the displayed original is a Windows UNC path', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockResolvedValue({ kind: 'file' })

    render(
      <TestAgentRightPane sessionId="session-a" messages={[]} partsByMessageId={{}}>
        <OpenInputFilePreviewButton originalPath={'\\\\server\\share\\report.md' as AbsoluteFilePath} />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))

    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.md'
      )
    })
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-display-path', '\\\\server\\share\\report.md')
    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
    expect(ipcRequestMock).toHaveBeenCalledWith('file.get_metadata', {
      kind: 'path',
      path: '/internal/message-files/report.md'
    })
  })

  it('returns to the previously active Agent pane when closing an input preview', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      kind: 'file',
      type: 'text',
      size: 1,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/markdown'
    })

    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <OpenInputFilePreviewButton />
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(document.querySelector('[data-shell-tab-shortcut="status"]') as HTMLElement)
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('agent.right_pane.tabs.status')

    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('report.md')
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('agent.right_pane.tabs.status')
    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
  })

  it('preserves the closed-pane return target when switching between input previews', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    ipcRequestMock
      .mockRejectedValueOnce(new Error('missing original'))
      .mockResolvedValueOnce({ kind: 'file' })
      .mockRejectedValueOnce(new Error('missing original'))
      .mockResolvedValueOnce({ kind: 'file' })

    render(
      <TestAgentRightPane sessionId="session-a" messages={[]} partsByMessageId={{}}>
        <OpenInputFilePreviewButton label="open first preview" />
        <OpenInputFilePreviewButton
          displayName="second.md"
          label="open second preview"
          originalPath={'/Users/alice/second.md' as AbsoluteFilePath}
          previewPath={'/internal/message-files/second.md' as AbsoluteFilePath}
        />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open first preview' }))
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/report.md'
      )
    })
    fireEvent.click(screen.getByRole('button', { name: 'open second preview' }))
    await waitFor(() => {
      expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
        'data-preview-path',
        '/internal/message-files/second.md'
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'false')
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

  it('keeps a file-tree selection when an older input-preview request completes', async () => {
    const artifactPanePath = await vi.importActual<typeof ArtifactPanePath>(
      '@renderer/components/chat/panes/artifactPanePath'
    )
    resolveArtifactPaneFileSelectionMock.mockImplementation(artifactPanePath.resolveArtifactPaneFileSelection)
    let resolveOriginalMetadata: (metadata: PhysicalFileMetadata | null) => void = () => {}
    ipcRequestMock.mockImplementationOnce(
      () =>
        new Promise<PhysicalFileMetadata | null>((resolve) => {
          resolveOriginalMetadata = resolve
        })
    )

    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <OpenInputFilePreviewButton />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open input preview' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute(
      'data-preview-path',
      '/internal/message-files/report.md'
    )

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-preview-path', '/workspace/README.md')

    await act(async () => {
      resolveOriginalMetadata({
        kind: 'file',
        type: 'text',
        size: 1,
        createdAt: 1,
        modifiedAt: 1,
        mime: 'text/plain'
      })
      await Promise.resolve()
    })

    expect(ipcRequestMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-preview-path', '/workspace/README.md')
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

  it('opens a subagent flow from the shortcut environment context', () => {
    renderStatusTasks(
      [
        {
          id: 'subagent-1',
          status: 'in_progress',
          title: 'Inspect task state',
          taskType: 'local_agent',
          toolUseId: 'tool-use-1'
        }
      ],
      { openPanel: false }
    )

    const preview = screen.getByTestId('status-shortcut-preview')
    const taskButton = within(preview).getByRole('button', { name: /Inspect task state/ })
    expect(taskButton).toHaveClass('focus-visible:bg-accent', 'focus-visible:outline-none')
    expect(taskButton).not.toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring')
    fireEvent.click(taskButton)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('Inspect task state')
  })

  it('keeps a detached subagent spinning while it remains in the background task snapshot', () => {
    const taskEvent = {
      event: 'started' as const,
      taskId: 'subagent-1',
      toolUseId: 'tool-use-1',
      status: 'in_progress' as const,
      title: 'Run a detached subagent',
      taskType: 'subagent'
    }
    const taskPart = { type: 'data-agent-task-event', data: taskEvent } as unknown as CherryMessagePart
    const messages = [
      { id: 'm1', role: 'assistant', parts: [taskPart], metadata: { status: 'success' } }
    ] as CherryUIMessage[]
    backgroundTasksState.value = [
      { id: 'subagent-1', type: 'subagent', description: 'Run a detached subagent', toolCallId: 'tool-use-1' }
    ]
    render(
      <TestAgentRightPane sessionId="session-a" messages={messages} partsByMessageId={{ m1: [taskPart] }}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    const taskButton = screen.getByRole('button', { name: /Run a detached subagent/ })
    expect(taskButton.querySelector('.animate-spin')).not.toBeNull()
  })

  it('returns from a subagent flow to the status panel', async () => {
    const user = userEvent.setup()

    renderStatusTasks([
      {
        id: 'subagent-1',
        status: 'in_progress',
        title: 'Inspect task state',
        taskType: 'local_agent',
        toolUseId: 'tool-use-1'
      }
    ])

    const rightPane = screen.getByTestId('right-pane')
    await user.click(within(rightPane).getByRole('button', { name: /Inspect task state/ }))

    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('Inspect task state')

    await user.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('agent.right_pane.tabs.status')
    expect(screen.getByText('agent.right_pane.info.subagents')).toBeInTheDocument()
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

  it('renders local Workflow progress separately without offering a root FlowTab fallback', () => {
    const parts = [
      {
        type: 'data-agent-task-event',
        data: {
          event: 'started',
          taskId: 'workflow-1',
          toolUseId: 'workflow-tool',
          status: 'in_progress',
          title: 'Review PR',
          taskType: 'local_workflow',
          workflowName: 'review-pr'
        }
      },
      {
        type: 'data-agent-task-event',
        data: {
          event: 'progress',
          taskId: 'workflow-1',
          toolUseId: 'workflow-tool',
          status: 'in_progress',
          title: 'Reviewing renderer',
          activeText: 'Checking citation rendering',
          summary: 'Reviewing renderer files',
          lastToolName: 'Read',
          usage: { totalTokens: 1200, toolUses: 4, durationMs: 9000 }
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
    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    expect(screen.getByText('agent.right_pane.info.workflows')).toBeInTheDocument()
    expect(screen.queryByText('agent.right_pane.info.subagents')).toBeNull()
    expect(screen.getByText('review-pr')).toBeInTheDocument()
    expect(screen.getByText('Reviewing renderer files')).toBeInTheDocument()
    expect(screen.getByText('Checking citation rendering')).toBeInTheDocument()
    expect(screen.getByText(/Read · 1.2k · agent.right_pane.status.tool_uses · 9s/)).toBeInTheDocument()
    expect(screen.getByText('review-pr').closest('button')).toBeNull()
    expect(screen.queryByTestId('workflow-dag-panel')).toBeNull()
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
      screen.getByText('agent.right_pane.info.shell_tasks')
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
