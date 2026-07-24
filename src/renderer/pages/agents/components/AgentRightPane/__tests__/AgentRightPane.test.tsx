import type * as ArtifactPanePath from '@renderer/components/chat/panes/artifactPanePath'
import { useRightPanelState } from '@renderer/components/chat/panes/Shell'
import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { TreeDir, TreeDirRoot, TreeFile } from '@shared/utils/file'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
  buildAgentToolFlowProjectionMock,
  fileSessionDiscardMock,
  fileSessionFlushMock,
  fileSessionState,
  fileTreeModelState,
  fileTreeModelStore,
  resolveArtifactPaneFileSelectionMock,
  systemFileTreeState,
  useArtifactFileTreeModelMock,
  useCommandHandlerMock,
  useDirectoryTreeMock
} = vi.hoisted(() => ({
  buildAgentToolFlowProjectionMock: vi.fn(),
  fileSessionDiscardMock: vi.fn(),
  fileSessionFlushMock: vi.fn().mockResolvedValue(undefined),
  fileSessionState: {
    isDirty: false,
    isSaving: false,
    saveError: undefined as Error | undefined
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
  useArtifactFileTreeModelMock: vi.fn(),
  useCommandHandlerMock: vi.fn(),
  useDirectoryTreeMock: vi.fn()
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
  HoverCard: ({ children }: PropsWithChildren) => <div>{children}</div>,
  HoverCardContent: ({ children }: PropsWithChildren) => <div data-testid="status-shortcut-preview">{children}</div>,
  HoverCardTrigger: ({ children }: PropsWithChildren) =>
    isValidElement(children) ? (
      // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild slot behavior
      cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-hover-card-trigger': 'true' })
    ) : (
      <>{children}</>
    ),
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

vi.mock('@renderer/components/chat/agent/ContextUsageSummary', () => ({
  ContextUsageSummary: () => <div data-testid="context-usage" />,
  getAgentContextUsageColor: () => 'success'
}))

vi.mock('@renderer/components/chat/messages/MessageList', () => ({
  default: () => <div data-testid="message-list" />
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  MessageListProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/utils/filePath', () => ({
  resolveInlineFilePath: (path: string) => path
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', async () => ({
  ArtifactFilePreview: () => <div data-testid="artifact-preview" />,
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
  isOfficeDocumentFile: () => false,
  isImageFile: () => false,
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

vi.mock('@renderer/components/chat/trace/TracePane', () => ({
  TracePane: () => <div data-testid="trace-pane" />
}))

vi.mock('@renderer/components/command', () => ({
  CommandTooltip: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children }: PropsWithChildren) => <div>{children}</div>
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
const stableT = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT })
}))

import { AgentRightPane, useAgentRightPaneActions } from '../AgentRightPane'

type TestAgentRightPaneProps = ComponentProps<typeof AgentRightPane.Scope>

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

function OpenArtifactButton() {
  const { openArtifactFile } = useAgentRightPaneActions()
  return (
    <button type="button" onClick={() => openArtifactFile('report.md')}>
      open artifact
    </button>
  )
}

function UserOpenSeqProbe() {
  const { userOpenSeq } = useRightPanelState()
  return <output data-testid="user-open-seq">{userOpenSeq}</output>
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
    useDirectoryTreeMock.mockImplementation(() => systemFileTreeState)
    useArtifactFileTreeModelMock.mockImplementation(() => ({
      hasLoaded: fileTreeModelState.hasLoaded,
      nodeById: fileTreeModelState.nodeById
    }))
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

  it('marks direct artifact opening as user initiated', () => {
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
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('report.md')
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

  it('renders artifact status filenames with neutral text', () => {
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'artifacts-1',
        toolName: 'report_artifacts',
        state: 'output-available',
        input: {
          artifacts: [{ path: 'docs/report.md', description: 'Summary report' }]
        }
      }
    ] as unknown as CherryMessagePart[]
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts,
        metadata: {}
      }
    ] as CherryUIMessage[]

    render(
      <TestAgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        messages={messages}
        partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
      </TestAgentRightPane>
    )

    const artifactButton = screen.getByRole('button', { name: 'report.md' })
    expect(artifactButton).not.toHaveClass('text-primary')
    expect(artifactButton).toHaveClass('text-foreground-secondary')
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

  it('keeps a visited trace capability mounted while inactive', () => {
    render(
      <TestAgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Viewport />
      </TestAgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'trace.label' }))
    const tracePane = screen.getByTestId('trace-pane')

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.files' }))
    expect(screen.getByTestId('trace-pane')).toBe(tracePane)
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
