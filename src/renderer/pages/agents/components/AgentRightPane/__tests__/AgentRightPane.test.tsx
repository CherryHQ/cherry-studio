import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, CSSProperties, PropsWithChildren, ReactElement, ReactNode } from 'react'
import { cloneElement, isValidElement, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fileTreeModelState, resetLazyChildrenMock, useArtifactFileTreeModelMock, useCommandHandlerMock } = vi.hoisted(
  () => ({
    fileTreeModelState: {
      hasLoaded: false,
      nodeById: new Map<string, { kind: string }>()
    },
    resetLazyChildrenMock: vi.fn(),
    useArtifactFileTreeModelMock: vi.fn(),
    useCommandHandlerMock: vi.fn()
  })
)

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
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
  RightPaneHost: ({
    children,
    onCloseAnimationComplete,
    open,
    style
  }: PropsWithChildren<{
    onCloseAnimationComplete?: () => void
    open?: boolean
    style?: CSSProperties
  }>) => {
    useEffect(() => {
      if (!open) onCloseAnimationComplete?.()
    }, [onCloseAnimationComplete, open])

    return (
      <section data-testid="right-pane" data-open={String(Boolean(open))} style={style}>
        {open ? children : null}
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

vi.mock('@renderer/components/chat/panes/ArtifactPane', () => ({
  ArtifactFilePreview: () => <div data-testid="artifact-preview" />,
  ArtifactPaneView: ({
    onPreviewClose,
    onSelectedFileChange,
    previewFileSelection,
    selectedFile
  }: {
    onPreviewClose?: () => void
    onSelectedFileChange: (file: string | null) => void
    previewFileSelection?: { workspacePath: string; filePath: string } | null
    selectedFile: string | null
  }) => (
    <div data-testid="artifact-pane" data-selected-file={selectedFile ?? ''}>
      <button type="button" onClick={() => onSelectedFileChange('README.md')}>
        select README.md
      </button>
      <button type="button" onClick={() => onSelectedFileChange('src/deep.ts')}>
        select src/deep.ts
      </button>
      {previewFileSelection && (
        <div data-testid="artifact-file-preview-overlay">
          {previewFileSelection.filePath}
          <button type="button" onClick={onPreviewClose}>
            close
          </button>
        </div>
      )}
    </div>
  ),
  isOfficeDocumentFile: () => false,
  isImageFile: () => false,
  resolveArtifactPaneFileSelection: () => null
}))

vi.mock('@renderer/components/chat/panes/OpenExternalAppButton', () => ({
  default: ({ workdir }: { workdir: string }) => (
    <button type="button" data-workdir={workdir}>
      Open external
    </button>
  )
}))

vi.mock('@renderer/components/chat/panes/useArtifactFileTreeModel', () => ({
  isSelectableFileNode: (nodeById: ReadonlyMap<string, { kind: string }>, selectedFile: string | null) =>
    Boolean(selectedFile && nodeById.get(selectedFile)?.kind === 'file'),
  useArtifactFileTreeModel: useArtifactFileTreeModelMock
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { AgentRightPane } from '../AgentRightPane'

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
    fileTreeModelState.hasLoaded = false
    fileTreeModelState.nodeById = new Map()
    useArtifactFileTreeModelMock.mockImplementation(() => ({
      hasLoaded: fileTreeModelState.hasLoaded,
      nodeById: fileTreeModelState.nodeById,
      resetLazyChildren: resetLazyChildrenMock
    }))
  })

  it('uses a title header and keeps stable shortcuts available while the pane is open', () => {
    render(
      <AgentRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'agent.session.list.title' }}
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    expect(screen.queryByRole('button', { name: 'agent.session.list.title' })).toBeNull()
    const opener = screen.getByRole('button', { name: 'Open external' })
    const filesShortcut = screen.getByRole('button', { name: 'agent.right_pane.tabs.files' })
    expect(opener).toHaveAttribute('data-workdir', '/workspace')
    expect(opener.compareDocumentPosition(filesShortcut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(filesShortcut).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'trace.label' })).toBeInTheDocument()
    expect(screen.getByTestId('status-shortcut-preview')).toBeInTheDocument()

    const statusShortcut = document.querySelector('[data-shell-tab-shortcut="status"]')
    expect(statusShortcut).toBeInTheDocument()
    expect(statusShortcut).toHaveAttribute('data-hover-card-trigger', 'true')

    fireEvent.click(statusShortcut as HTMLElement)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.queryByRole('button', { name: 'Open external' })).toBeNull()
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
      <AgentRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'agent.session.list.title' }}
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Host />
      </AgentRightPane>
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
      <AgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    act(triggerRightSidebarShortcut)

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('agent.right_pane.tabs.files')
    expect(screen.getByTestId('artifact-pane')).toBeInTheDocument()
  })

  it('hides file and status shortcuts when their matching tabs are disabled', () => {
    render(
      <AgentRightPane
        resourcePane={{ node: <div data-testid="resource-list">Resources</div>, label: 'agent.session.list.title' }}
        filesEnabled={false}
        statusEnabled={false}
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    expect(screen.queryByRole('button', { name: 'agent.session.list.title' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'agent.right_pane.tabs.files' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'agent.right_pane.tabs.status' })).toBeNull()
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
      <AgentRightPane
        sessionId="session-a"
        workspacePath="/workspace"
        messages={messages}
        partsByMessageId={{ m1: parts }}>
        <AgentRightPane.Shortcuts />
      </AgentRightPane>
    )

    const artifactButton = screen.getByRole('button', { name: 'report.md' })
    expect(artifactButton).not.toHaveClass('text-primary')
    expect(artifactButton).toHaveClass('text-foreground-secondary')
  })

  it('keeps the file-tree model closed while the shell is closed', () => {
    render(
      <AgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    expect(useArtifactFileTreeModelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        treeOpen: false,
        workspacePath: '/workspace'
      })
    )
  })

  it('keeps the file-tree model closed when opening a non-files tab', () => {
    render(
      <AgentRightPane sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Shortcuts />
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.right_pane.tabs.status' }))

    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-open', 'true')
    expect(useArtifactFileTreeModelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        treeOpen: false,
        workspacePath: '/workspace'
      })
    )
  })

  it('keeps the file-tree model closed when files are disabled', () => {
    render(
      <AgentRightPane
        defaultOpen
        filesEnabled={false}
        sessionId="session-a"
        workspacePath="/workspace"
        messages={[]}
        partsByMessageId={{}}>
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    expect(useArtifactFileTreeModelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        treeOpen: false,
        workspacePath: '/workspace'
      })
    )
  })

  it('clears the overlay preview when the selected file disappears from the tree model', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([['README.md', { kind: 'file' }]])

    const { rerender } = render(
      <AgentRightPane defaultOpen sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))

    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md')

    fileTreeModelState.nodeById = new Map()
    rerender(
      <AgentRightPane defaultOpen sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', '')
  })

  it('keeps an unindexed selection after a previously indexed file was selectable', () => {
    fileTreeModelState.hasLoaded = true
    fileTreeModelState.nodeById = new Map([['README.md', { kind: 'file' }]])

    render(
      <AgentRightPane defaultOpen sessionId="session-a" workspacePath="/workspace" messages={[]} partsByMessageId={{}}>
        <AgentRightPane.Host />
      </AgentRightPane>
    )

    fireEvent.click(screen.getByRole('button', { name: 'select README.md' }))
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md')

    fireEvent.click(screen.getByRole('button', { name: 'select src/deep.ts' }))

    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('src/deep.ts')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-selected-file', 'src/deep.ts')
  })
})
