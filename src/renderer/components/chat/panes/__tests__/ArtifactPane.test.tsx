import { loggerService } from '@logger'
import type { SerializedTreeNode } from '@shared/utils/file/tree'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ArtifactPane, { ARTIFACT_FILE_TREE_DEFAULT_WIDTH, resolveArtifactPaneFileSelection } from '../ArtifactPane'

const mocks = vi.hoisted(() => ({
  treeCreate: vi.fn(),
  treeDispose: vi.fn(),
  treeOnMutation: vi.fn(),
  fsRead: vi.fn(),
  fsReadText: vi.fn(),
  isTextFile: vi.fn(),
  getMetadata: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  pdfPreviewPanelProps: [] as Array<{
    fileName: string
    filePath: string
    refreshKey: number
  }>,
  pdfPreviewPanelModuleLoadCount: 0,
  artifactFileTreeWidth: null as number | null,
  setArtifactFileTreeWidth: vi.fn((width: number) => {
    mocks.artifactFileTreeWidth = width
  }),
  nextTreeId: 0
}))

/**
 * Convert the flat-path fixtures the tests still use into a
 * `SerializedTreeNode` snapshot — the wire shape `useDirectoryTree`
 * receives from the main-side `File_TreeCreate` IPC. Absolute paths outside
 * the workspace are silently dropped (matching what the watcher would
 * surface in practice: nothing).
 */
function pathsToSnapshot(workspacePath: string, paths: readonly string[]): SerializedTreeNode {
  const normalizedWorkspace = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const wsBase = normalizedWorkspace || '/'
  const wsName = wsBase.split('/').filter(Boolean).pop() ?? wsBase

  const relPaths: string[] = []
  for (const raw of paths) {
    const norm = raw.replace(/\\/g, '/')
    if (norm === wsBase) continue
    if (norm.startsWith(`${wsBase}/`)) {
      relPaths.push(norm.slice(wsBase.length + 1))
      continue
    }
    if (/^(?:[A-Za-z]:)?\//.test(norm)) continue // unrelated absolute path
    relPaths.push(norm.replace(/^\/+/, ''))
  }

  // Any segment that is itself a path prefix of another listed path is a
  // directory; everything else is a file.
  const dirSet = new Set<string>()
  for (const rel of relPaths) {
    const segments = rel.split('/').filter(Boolean)
    for (let i = 1; i < segments.length; i += 1) {
      dirSet.add(segments.slice(0, i).join('/'))
    }
  }
  for (const rel of relPaths) {
    if (dirSet.has(rel)) continue // already known to be a parent dir
  }

  const root: SerializedTreeNode = {
    kind: 'directory',
    path: wsBase,
    basename: wsName,
    children: {}
  }

  const ensureDir = (parent: SerializedTreeNode, relPath: string, basename: string): SerializedTreeNode => {
    const children = parent.children as Record<string, SerializedTreeNode>
    const existing = children[basename]
    if (existing && existing.kind === 'directory') return existing
    const dir: SerializedTreeNode = {
      kind: 'directory',
      path: `${wsBase}/${relPath}`,
      basename,
      children: {}
    }
    children[basename] = dir
    return dir
  }

  for (const rel of relPaths) {
    const segments = rel.split('/').filter(Boolean)
    if (segments.length === 0) continue
    let parent: SerializedTreeNode = root
    for (let i = 0; i < segments.length; i += 1) {
      const name = segments[i]
      const isLast = i === segments.length - 1
      const currentRelPath = segments.slice(0, i + 1).join('/')
      const treatAsDir = !isLast || dirSet.has(currentRelPath)
      if (treatAsDir) {
        parent = ensureDir(parent, currentRelPath, name)
      } else {
        const children = parent.children as Record<string, SerializedTreeNode>
        if (!children[name]) {
          children[name] = { kind: 'file', path: `${wsBase}/${currentRelPath}`, basename: name }
        }
      }
    }
  }

  return root
}

function mockWorkspaceTree(workspacePath: string, paths: readonly string[]): void {
  mocks.nextTreeId += 1
  const treeId = `tree-${mocks.nextTreeId}`
  const snapshot = pathsToSnapshot(workspacePath, paths)
  mocks.treeCreate.mockResolvedValueOnce({ treeId, snapshot })
}

vi.mock('@cherrystudio/ui', async () => {
  return {
    Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    ButtonGroup: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
      <div {...props}>{children}</div>
    ),
    MenuItem: ({
      label,
      icon,
      active,
      onClick
    }: {
      label: string
      icon?: React.ReactNode
      active?: boolean
      onClick?: () => void
    }) => (
      <button type="button" data-active={String(active)} onClick={onClick}>
        {icon}
        {label}
      </button>
    ),
    MenuList: ({ children }: PropsWithChildren) => <div>{children}</div>,
    NormalTooltip: ({ children, content }: PropsWithChildren<{ content: string }>) => (
      <div data-testid="normal-tooltip" data-content={content}>
        {children}
      </div>
    ),
    Popover: ({ children }: PropsWithChildren) => <div>{children}</div>,
    PopoverContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    PopoverTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
    Tooltip: ({ children, content }: PropsWithChildren<{ content: string }>) => (
      <div data-testid="tooltip" data-content={content}>
        {children}
      </div>
    ),
    Markdown: ({ id, children }: { id: string; children: string }) => (
      <div data-testid="markdown" data-md-id={id}>
        {children}
      </div>
    )
  }
})

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' ')
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial,
      animate,
      exit,
      transition,
      ...props
    }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>> & {
      initial?: { width?: number; opacity?: number }
      animate?: { width?: number; opacity?: number }
      exit?: { width?: number; opacity?: number }
      transition?: unknown
    }) => (
      <div
        data-testid="artifact-file-tree-motion-pane"
        data-initial-width={initial?.width}
        data-initial-opacity={initial?.opacity}
        data-animate-width={animate?.width}
        data-animate-opacity={animate?.opacity}
        data-exit-width={exit?.width}
        data-exit-opacity={exit?.opacity}
        data-has-transition={String(Boolean(transition))}
        {...props}>
        {children}
      </div>
    )
  }
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ rows }: { rows?: number }) => <div data-testid="loading-state" data-rows={rows} />
}))

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: ({
    nodes,
    selectedId,
    onSelectedChange,
    ...props
  }: {
    nodes: MockFileTreeNode[]
    selectedId?: string | null
    onSelectedChange?: (id: string | null) => void
    truncateLabels?: boolean
  }) => {
    const renderNode = (node: MockFileTreeNode) => (
      <div key={node.id}>
        <button
          type="button"
          data-testid={`tree-node-${node.id}`}
          data-kind={node.kind}
          data-selected={String(selectedId === node.id)}
          onClick={() => onSelectedChange?.(node.id)}>
          {node.name}
        </button>
        {node.children?.map(renderNode)}
      </div>
    )

    return (
      <div data-testid="file-tree" data-truncate-labels={String(props.truncateLabels)}>
        {nodes.map(renderNode)}
      </div>
    )
  }
}))

interface MockFileTreeNode {
  id: string
  name: string
  kind: 'file' | 'folder'
  children?: MockFileTreeNode[]
}

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value, language, wrapped }: { value: string; language: string; wrapped?: boolean }) => (
    <div data-testid="code-viewer" data-language={language} data-wrapped={String(wrapped)}>
      {value}
    </div>
  )
}))

vi.mock('../PdfPreviewPanel', () => {
  mocks.pdfPreviewPanelModuleLoadCount += 1

  return {
    default: (props: { fileName: string; filePath: string; refreshKey: number }) => {
      mocks.pdfPreviewPanelProps.push(props)

      return (
        <div
          data-testid="pdf-preview-panel"
          data-file-name={props.fileName}
          data-file-path={props.filePath}
          data-refresh-key={props.refreshKey}
        />
      )
    }
  }
})

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: (key: string) =>
    key === 'ui.chat.artifact_pane.file_tree.width'
      ? [mocks.artifactFileTreeWidth, mocks.setArtifactFileTreeWidth]
      : [null, vi.fn()]
}))

vi.mock('@renderer/components/Icons/SvgIcon', () => ({
  FinderIcon: (props: React.SVGProps<SVGSVGElement>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: () => ({ data: [] })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; extension?: string; name?: string }) => {
      if (key === 'agent.preview_pane.items') return `${options?.count ?? 0} localized items`
      if (key === 'agent.preview_pane.office.title') return `unsupported ${options?.extension ?? ''}`
      if (key === 'agent.session.file_manager.finder') return 'Finder'
      if (key === 'common.open_in') return `Open in ${options?.name ?? ''}`
      return key
    }
  })
}))

describe('ArtifactPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.artifactFileTreeWidth = null
    mocks.pdfPreviewPanelProps.length = 0
    mocks.nextTreeId = 0
    // Default: every test gets an empty tree unless it queues a fixture
    // via `mockWorkspaceTree(...)` (which calls `mockResolvedValueOnce`).
    mocks.treeCreate.mockResolvedValue({
      treeId: 'tree-default',
      snapshot: pathsToSnapshot('/tmp/workspace', [])
    })
    // `restoreAllMocks` in afterEach wipes out custom implementations, so
    // re-bind via `mockImplementation` (more robust than `mockResolvedValue`
    // for callers that don't await the returned promise — the hook does
    // `dispose(...).catch(...)`).
    mocks.treeDispose.mockImplementation(() => Promise.resolve())
    mocks.treeOnMutation.mockImplementation(() => () => {})
    // Default: tests select text files; override per-test for binary cases.
    mocks.isTextFile.mockResolvedValue(true)
    // Default: tests use tiny files; override per-test to exercise the size gate.
    mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 1024 })
    mocks.createObjectURL.mockReturnValue('blob:fake-url')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          openPath: vi.fn(),
          isTextFile: mocks.isTextFile,
          getMetadata: mocks.getMetadata
        },
        fs: {
          read: mocks.fsRead,
          readText: mocks.fsReadText
        },
        tree: {
          create: mocks.treeCreate,
          dispose: mocks.treeDispose,
          onMutation: mocks.treeOnMutation
        }
      }
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: mocks.createObjectURL
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: mocks.revokeObjectURL
    })
  })

  afterEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  it('resolves workspace file paths relative to the artifact workspace', () => {
    expect(resolveArtifactPaneFileSelection('/tmp/workspace', '/tmp/workspace/src/index.ts')).toEqual({
      workspacePath: '/tmp/workspace',
      filePath: 'src/index.ts'
    })
  })

  it('resolves absolute file paths outside the workspace from their parent directory', () => {
    expect(resolveArtifactPaneFileSelection('/tmp/workspace', '/Users/suyao/Desktop/记忆商人.md')).toEqual({
      workspacePath: '/Users/suyao/Desktop',
      filePath: '记忆商人.md'
    })
  })

  it('re-roots a workspace-relative path that escapes via ".." so the tree root and previewed file agree', () => {
    // Out-of-workspace previews are intentional (the agent creates files outside the workspace), but a
    // `..`-escaping path must re-root like the absolute branch — otherwise the tree shows the workspace
    // while the preview reads outside it. Both the bare-relative and workspace-prefixed forms resolve here.
    expect(resolveArtifactPaneFileSelection('/tmp/workspace', '../secret.md')).toEqual({
      workspacePath: '/tmp/workspace/..',
      filePath: 'secret.md'
    })
    expect(resolveArtifactPaneFileSelection('/tmp/workspace', '/tmp/workspace/../secret.md')).toEqual({
      workspacePath: '/tmp/workspace/..',
      filePath: 'secret.md'
    })
  })

  it('does not load the PDF preview panel module for non-PDF selections', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValue('# Hello')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))

    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Hello'))
    expect(mocks.pdfPreviewPanelModuleLoadCount).toBe(0)
  })

  it('shows the ready empty state when no workspace path is available', () => {
    render(<ArtifactPane />)

    expect(mocks.treeCreate).not.toHaveBeenCalled()
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.description')
  })

  it('requests the workspace tree from DirectoryTreeBuilder', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md', 'src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(mocks.treeCreate).toHaveBeenCalledWith('/tmp/workspace', expect.any(Object)))
  })

  it('logs and displays directory listing errors', async () => {
    const error = new Error('Permission denied')
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    mocks.treeCreate.mockRejectedValueOnce(error)

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(screen.getByText('Permission denied')).toBeInTheDocument())
    expect(screen.getByTestId('empty-state')).toHaveTextContent('common.error')
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent('agent.preview_pane.empty.title')
    expect(errorSpy).toHaveBeenCalledWith('Failed to create directory tree for /tmp/workspace', error)
  })

  it('renders header tool buttons without a close button or view-mode toggle', () => {
    render(<ArtifactPane onToggleMaximized={vi.fn()} />)

    for (const label of ['agent.preview_pane.file_tree', 'agent.preview_pane.refresh', 'agent.preview_pane.maximize']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'agent.preview_pane.preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.preview_pane.code' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.preview_pane.close' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('uses the minimize action while maximized', () => {
    const onToggleMaximized = vi.fn()

    const { container } = render(<ArtifactPane maximized onToggleMaximized={onToggleMaximized} />)

    const minimizeButton = screen.getByRole('button', { name: 'agent.preview_pane.minimize' })
    expect(container.firstElementChild).toHaveClass('rounded-lg', 'border', 'border-border-subtle', 'shadow-sm')
    expect(minimizeButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'agent.preview_pane.maximize' })).not.toBeInTheDocument()

    fireEvent.click(minimizeButton)

    expect(onToggleMaximized).toHaveBeenCalledTimes(1)
  })

  it('renders the workspace opener between refresh and maximize when a workspace path exists', async () => {
    render(<ArtifactPane workspacePath="/tmp/workspace" onToggleMaximized={vi.fn()} />)

    await waitFor(() => expect(mocks.treeCreate).toHaveBeenCalledWith('/tmp/workspace', expect.any(Object)))

    const refreshButton = screen.getByRole('button', { name: 'agent.preview_pane.refresh' })
    const openButton = screen.getByRole('button', { name: 'Open in Finder' })
    const maximizeButton = screen.getByRole('button', { name: 'agent.preview_pane.maximize' })
    const toolbarButtons = screen.getAllByRole('button')

    expect(toolbarButtons.indexOf(openButton)).toBe(toolbarButtons.indexOf(refreshButton) + 1)
    expect(toolbarButtons.indexOf(maximizeButton)).toBe(toolbarButtons.indexOf(openButton) + 1)
  })

  it('does not render the workspace opener without a workspace path', () => {
    render(<ArtifactPane />)

    expect(screen.queryByRole('button', { name: 'Open in Finder' })).not.toBeInTheDocument()
  })

  it('starts with the file tree collapsed', () => {
    render(<ArtifactPane />)

    const folderButton = screen.getByRole('button', { name: 'agent.preview_pane.file_tree' })

    expect(folderButton).toHaveAttribute('aria-pressed', 'false')
    expect(folderButton.querySelector('.lucide-folder')).toBeInTheDocument()
    expect(folderButton.querySelector('.lucide-folder-open')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-tree')).not.toBeInTheDocument()
  })

  it('keeps the toolbar inside the right content column', () => {
    const { container } = render(<ArtifactPane />)

    const root = container.firstElementChild
    const body = root?.firstElementChild
    const content = body?.querySelector('section')
    const toolbar = content?.firstElementChild
    const preview = content?.children.item(1)

    expect(root).toHaveClass('h-full', 'min-h-0', 'overflow-hidden')
    expect(root).not.toHaveClass('rounded-2xl', 'border-frame-border', 'shadow-sm')
    expect(body).toHaveClass('min-h-0', 'overflow-hidden')
    expect(toolbar).toHaveClass('h-(--navbar-height)')
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    expect(content).toHaveClass('min-h-0', 'min-w-0')
    expect(preview).toHaveClass('min-h-0', 'min-w-0', 'overflow-auto')
  })

  it('toggles the file tree when the folder button is clicked', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    const folderButton = screen.getByRole('button', { name: 'agent.preview_pane.file_tree' })

    expect(folderButton).toHaveAttribute('aria-pressed', 'false')
    expect(folderButton.querySelector('.lucide-folder')).toBeInTheDocument()
    expect(folderButton.querySelector('.lucide-folder-open')).not.toBeInTheDocument()

    fireEvent.click(folderButton)
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeInTheDocument())
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute('data-initial-width', '0')
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute('data-initial-opacity', '0')
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute(
      'data-animate-width',
      String(ARTIFACT_FILE_TREE_DEFAULT_WIDTH)
    )
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute('data-animate-opacity', '1')
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute('data-exit-width', '0')
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute('data-exit-opacity', '0')
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute('data-has-transition', 'true')
    expect(screen.getByTestId('file-tree')).toHaveAttribute('data-truncate-labels', 'undefined')
    expect(screen.getByTestId('tree-node-__workspace_root__')).toHaveTextContent('workspace')
    expect(screen.getByTestId('tree-node-README.md')).toHaveTextContent('README.md')
    expect(folderButton).toHaveAttribute('aria-pressed', 'true')
    expect(folderButton.querySelector('.lucide-folder-open')).toBeInTheDocument()
    expect(folderButton.querySelector('.lucide-folder')).not.toBeInTheDocument()

    fireEvent.click(folderButton)
    await waitFor(() => expect(screen.queryByTestId('file-tree')).not.toBeInTheDocument())
    expect(folderButton).toHaveAttribute('aria-pressed', 'false')
    expect(folderButton.querySelector('.lucide-folder')).toBeInTheDocument()
    expect(folderButton.querySelector('.lucide-folder-open')).not.toBeInTheDocument()
  })

  it('renders a right-edge resize handle for the file tree', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeInTheDocument())

    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')
    const scrollRegion = container.querySelector('[data-artifact-file-tree-scroll-region]')

    expect(handle).toBeInTheDocument()
    expect(handle).toHaveClass('right-0', 'cursor-col-resize')
    expect(scrollRegion).toHaveClass('overflow-y-auto', 'overflow-x-hidden')
  })

  it('clamps dragged file tree width from the default artifact pane width and cleans document resize styles', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeInTheDocument())

    const pane = container.querySelector('[data-artifact-file-tree-pane]')
    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected artifact file tree pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, ARTIFACT_FILE_TREE_DEFAULT_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 260 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')
    expect(screen.getByTestId('artifact-file-tree-motion-pane')).toHaveAttribute('data-has-transition', 'true')

    fireEvent.mouseMove(document, { clientX: 250 })
    fireEvent.mouseMove(document, { clientX: 180 })
    fireEvent.mouseMove(document, { clientX: 500 })

    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(1, 150)
    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(2, 80)
    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(3, 320)

    fireEvent.mouseUp(document)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')
  })

  it('cleans the file tree resize state on window blur', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeInTheDocument())

    const pane = container.querySelector('[data-artifact-file-tree-pane]')
    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected artifact file tree pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, ARTIFACT_FILE_TREE_DEFAULT_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 260 })
    fireEvent.mouseMove(document, { clientX: 250 })
    expect(pane).toHaveAttribute('data-resizing', 'true')
    expect(document.body.style.cursor).toBe('col-resize')
    expect(mocks.setArtifactFileTreeWidth).toHaveBeenCalledTimes(1)

    fireEvent.blur(window)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')

    fireEvent.mouseMove(document, { clientX: 500 })

    expect(mocks.setArtifactFileTreeWidth).toHaveBeenCalledTimes(1)
  })

  it('clamps dragged file tree width from the measured artifact pane width', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeInTheDocument())

    const root = container.firstElementChild
    const pane = container.querySelector('[data-artifact-file-tree-pane]')
    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')

    if (!root || !pane || !handle) {
      throw new Error('Expected artifact root, file tree pane, and resize handle')
    }

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 500))
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, ARTIFACT_FILE_TREE_DEFAULT_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 260 })
    fireEvent.mouseMove(document, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 600 })
    fireEvent.mouseUp(document)

    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(1, 80)
    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(2, 360)
  })

  it('keeps a non-zero minimum file tree width for narrow artifact panes', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeInTheDocument())

    const root = container.firstElementChild
    const pane = container.querySelector('[data-artifact-file-tree-pane]')
    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')

    if (!root || !pane || !handle) {
      throw new Error('Expected artifact root, file tree pane, and resize handle')
    }

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 360, 500))
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, ARTIFACT_FILE_TREE_DEFAULT_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 260 })
    fireEvent.mouseMove(document, { clientX: 50 })
    fireEvent.mouseUp(document)

    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(1, 80)
  })

  it('caps the minimum file tree width for large artifact panes', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('file-tree')).toBeInTheDocument())

    const root = container.firstElementChild
    const pane = container.querySelector('[data-artifact-file-tree-pane]')
    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')

    if (!root || !pane || !handle) {
      throw new Error('Expected artifact root, file tree pane, and resize handle')
    }

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 720, 500))
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, ARTIFACT_FILE_TREE_DEFAULT_WIDTH, 500))

    fireEvent.mouseDown(handle, { clientX: 260 })
    fireEvent.mouseMove(document, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 800 })
    fireEvent.mouseUp(document)

    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(1, 80)
    expect(mocks.setArtifactFileTreeWidth).toHaveBeenNthCalledWith(2, 580)
  })

  it('disables HTML iframe pointer events while resizing the file tree', async () => {
    mockWorkspaceTree('/tmp/workspace', ['index.html'])
    mocks.fsReadText.mockResolvedValue('<!doctype html><html><body><h1>Hello</h1></body></html>')

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-index.html')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-index.html'))
    await waitFor(() => expect(container.querySelector('iframe[title="index.html"]')).not.toBeNull())

    const pane = container.querySelector('[data-artifact-file-tree-pane]')
    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')
    const rightPane = container.querySelector('[data-artifact-right-pane]')

    if (!pane || !handle || !rightPane) {
      throw new Error('Expected artifact panes and resize handle')
    }

    fireEvent.mouseDown(handle, { clientX: 260 })

    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')
    expect(rightPane).toHaveClass('pointer-events-none')

    fireEvent.mouseUp(document)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(rightPane).not.toHaveClass('pointer-events-none')
  })

  it('disables PDF preview panel pointer events while resizing the file tree', async () => {
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument())

    const pane = container.querySelector('[data-artifact-file-tree-pane]')
    const handle = container.querySelector('[data-artifact-file-tree-resize-handle]')
    const rightPane = container.querySelector('[data-artifact-right-pane]')

    if (!pane || !handle || !rightPane) {
      throw new Error('Expected artifact panes and resize handle')
    }

    fireEvent.mouseDown(handle, { clientX: 260 })

    expect(pane).toHaveAttribute('data-resizing', 'true')
    expect(rightPane).toHaveClass('pointer-events-none')

    fireEvent.mouseUp(document)

    expect(rightPane).not.toHaveClass('pointer-events-none')
  })

  it('renders markdown files through the shared Markdown component', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValue('# Hello')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/README.md'))
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Hello')
    expect(screen.queryByTestId('code-viewer')).not.toBeInTheDocument()
  })

  it('supports controlled selected file state', async () => {
    const onSelectedFileChange = vi.fn()
    mockWorkspaceTree('/tmp/workspace', ['README.md', 'src/index.ts'])
    mocks.fsReadText.mockResolvedValue('# Controlled')

    render(
      <ArtifactPane
        workspacePath="/tmp/workspace"
        selectedFile="README.md"
        onSelectedFileChange={onSelectedFileChange}
      />
    )

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/README.md'))
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Controlled')

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())
    expect(screen.getByTestId('tree-node-README.md')).toHaveAttribute('data-selected', 'true')

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    expect(onSelectedFileChange).toHaveBeenCalledWith('src/index.ts')
  })

  it('renders text file previews without wrapping so horizontal overflow can scroll', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.fsReadText.mockResolvedValue('const value = "a very long line";')

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/index.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/src/index.ts'))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('const value = "a very long line";')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-language', 'TypeScript')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-wrapped', 'false')
    expect(container.querySelector('section')?.children.item(1)).toHaveClass('overflow-auto')
  })

  it('renders HTML previews in an iframe with Popup-aligned sandbox, file base, and hidden outer overflow', async () => {
    mockWorkspaceTree('/tmp/workspace', ['index.html'])
    mocks.fsReadText.mockResolvedValue(
      '<!doctype html><html><head><title>Hello</title></head><body><a href="about.html">About</a></body></html>'
    )

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-index.html')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-index.html'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/index.html'))
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const srcDoc = iframe?.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('<base href="file:///tmp/workspace/index.html">')
    expect(srcDoc).toContain('<a href="about.html">About</a>')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    expect(iframe).toHaveAttribute('title', 'index.html')
    expect(iframe).toHaveClass('h-full', 'w-full', 'border-0', 'bg-background')
    expect(container.querySelector('section')?.children.item(1)).toHaveClass('overflow-hidden')
  })

  it('keeps empty HTML previews blank without showing the Popup empty text', async () => {
    mockWorkspaceTree('/tmp/workspace', ['empty.html'])
    mocks.fsReadText.mockResolvedValue('   ')

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-empty.html')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-empty.html'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/empty.html'))
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByText('html_artifacts.empty_preview')).not.toBeInTheDocument()
    expect(container.querySelector('section')?.children.item(1)).toHaveClass('overflow-hidden')
  })

  it('does not read content when a folder node is selected', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-__workspace_root__')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-__workspace_root__'))
    fireEvent.click(screen.getByTestId('tree-node-src'))

    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('keeps returned directory entries as folders with real child files', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src', 'src/index.ts'])
    mocks.fsReadText.mockResolvedValue('export {}')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    expect(screen.getByTestId('tree-node-src')).toHaveAttribute('data-kind', 'folder')
    expect(screen.getByTestId('tree-node-src/index.ts')).toHaveAttribute('data-kind', 'file')

    fireEvent.click(screen.getByTestId('tree-node-src'))
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/src/index.ts'))
  })

  it('renders absolute file paths under the workspace root as relative children', async () => {
    mockWorkspaceTree('/Users/me/dev', ['/Users/me/dev/test.md'])

    render(<ArtifactPane workspacePath="/Users/me/dev" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-test.md')).toBeInTheDocument())

    expect(screen.getByTestId('tree-node-__workspace_root__')).toHaveTextContent('dev')
    expect(screen.queryByTestId('tree-node-Users')).not.toBeInTheDocument()
  })

  it('keeps absolute directory entries as relative folders with real child files', async () => {
    mockWorkspaceTree('/Users/me/dev', ['/Users/me/dev/src', '/Users/me/dev/src/index.ts'])
    mocks.fsReadText.mockResolvedValue('export {}')

    render(<ArtifactPane workspacePath="/Users/me/dev" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    expect(screen.getByTestId('tree-node-src')).toHaveAttribute('data-kind', 'folder')
    expect(screen.getByTestId('tree-node-src/index.ts')).toHaveAttribute('data-kind', 'file')
    expect(screen.queryByTestId('tree-node-Users')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/Users/me/dev/src/index.ts'))
  })

  it('renders PDF files with PdfPreviewPanel using the selected file path', async () => {
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument())
    expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-file-path', '/tmp/workspace/paper.pdf')
    expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-file-name', 'paper.pdf')
    expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-refresh-key', '0')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(mocks.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.pdfPreviewPanelProps.at(-1)).toEqual({
      filePath: '/tmp/workspace/paper.pdf',
      fileName: 'paper.pdf',
      refreshKey: 0
    })
  })

  it('passes the PDF layout refresh key to PdfPreviewPanel', async () => {
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    const { rerender } = render(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutRefreshKey={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-refresh-key', '0'))

    rerender(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutRefreshKey={1} />)

    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-refresh-key', '1'))
    expect(mocks.pdfPreviewPanelProps.at(-1)).toEqual({
      filePath: '/tmp/workspace/paper.pdf',
      fileName: 'paper.pdf',
      refreshKey: 1
    })
    expect(mocks.createObjectURL).not.toHaveBeenCalled()
  })

  it('shows loading instead of mounting the selected PDF while PDF layout is pending', async () => {
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    const { rerender } = render(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutPending />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    expect(screen.getByTestId('loading-state')).toBeInTheDocument()
    expect(screen.queryByTestId('pdf-preview-panel')).not.toBeInTheDocument()

    rerender(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutRefreshKey={1} />)

    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument())
    expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-refresh-key', '1')
    expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument()
  })

  it('does not read files the buffer sniff classifies as binary', async () => {
    mocks.isTextFile.mockResolvedValueOnce(false)
    mockWorkspaceTree('/tmp/workspace', ['image.png'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-image.png')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-image.png'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.code_unavailable')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('does not read unknown extensions when the sniff says binary', async () => {
    mocks.isTextFile.mockResolvedValueOnce(false)
    mockWorkspaceTree('/tmp/workspace', ['archive.custom'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-archive.custom')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-archive.custom'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.code_unavailable')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('shows the file-unavailable state when the size sniff fails (missing/moved file)', async () => {
    mocks.getMetadata.mockRejectedValueOnce(new Error('ENOENT: no such file'))
    mockWorkspaceTree('/tmp/workspace', ['gone.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-gone.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-gone.ts'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.unavailable.title')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('shows the file-unavailable state when reading text content fails', async () => {
    mocks.fsReadText.mockRejectedValueOnce(new Error('EACCES: permission denied'))
    mockWorkspaceTree('/tmp/workspace', ['locked.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-locked.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-locked.ts'))

    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.unavailable.title')
    )
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.unavailable.description')
    expect(screen.queryByTestId('code-viewer')).not.toBeInTheDocument()
  })

  it('reads unknown extensions when the sniff says text', async () => {
    mockWorkspaceTree('/tmp/workspace', ['notes.log'])
    mocks.fsReadText.mockResolvedValue('boot at 12:00')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-notes.log')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-notes.log'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/notes.log'))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('boot at 12:00')
  })

  it('skips preview and readText for text files above the 2 MB size cap', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 3 * 1024 * 1024 })
    mockWorkspaceTree('/tmp/workspace', ['huge.json'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-huge.json')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-huge.json'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.too_large.title')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('still renders PDFs above the 2 MB size cap', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 50 * 1024 * 1024 })
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument())
    expect(screen.queryByText('agent.preview_pane.too_large.title')).not.toBeInTheDocument()
  })

  it.each(['report.xlsx', 'report.xlsm', 'proposal.docx', 'legacy.doc', 'legacy.xls', 'slides.ppt', 'slides.pptx'])(
    'shows the Office document state for %s without reading source content',
    async (fileName) => {
      mockWorkspaceTree('/tmp/workspace', [fileName])

      render(<ArtifactPane workspacePath="/tmp/workspace" />)

      fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
      await waitFor(() => expect(screen.getByTestId(`tree-node-${fileName}`)).toBeInTheDocument())

      fireEvent.click(screen.getByTestId(`tree-node-${fileName}`))

      await waitFor(() => expect(screen.getByText(`unsupported ${fileName.split('.').pop()}`)).toBeInTheDocument())
      expect(screen.getByText('agent.preview_pane.office.description')).toBeInTheDocument()
      expect(screen.queryByText('agent.preview_pane.code_unavailable')).not.toBeInTheDocument()
      expect(screen.queryByText('agent.preview_pane.too_large.title')).not.toBeInTheDocument()
      expect(screen.queryByTestId('pdf-preview-panel')).not.toBeInTheDocument()
      expect(mocks.fsRead).not.toHaveBeenCalled()
      expect(mocks.fsReadText).not.toHaveBeenCalled()
      expect(mocks.isTextFile).not.toHaveBeenCalledWith(`/tmp/workspace/${fileName}`)
    }
  )

  it('renders non-markdown text files through CodeViewer with the resolved language', async () => {
    mockWorkspaceTree('/tmp/workspace', ['config.json'])
    mocks.fsReadText.mockResolvedValue('{"enabled":true}')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-config.json')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-config.json'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/config.json'))
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-language', 'JSON')
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('{"enabled":true}')
  })

  it('re-reads the selected text file when refresh is clicked', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValueOnce('# Before').mockResolvedValueOnce('# After')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Before'))

    // The watcher keeps the tree current; the refresh button now only
    // re-pulls the active file's content (the FS scan stays a one-shot).
    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.refresh' }))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledTimes(2))
    expect(mocks.fsReadText).toHaveBeenLastCalledWith('/tmp/workspace/README.md')
    expect(screen.getByTestId('markdown')).toHaveTextContent('# After')
    expect(mocks.treeCreate).toHaveBeenCalledTimes(1)
  })

  it('clears the selected file when the watcher reports the file was removed', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValueOnce('# Before')

    // Capture the live mutation listener so the test can push a `removed`
    // event the way the main-side builder would.
    let pushMutation: ((payload: { treeId: string; event: { type: 'removed'; path: string } }) => void) | undefined
    mocks.treeOnMutation.mockImplementation((cb) => {
      pushMutation = cb as typeof pushMutation
      return () => {
        pushMutation = undefined
      }
    })

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Before'))

    await waitFor(() => expect(pushMutation).toBeDefined())
    act(() => {
      pushMutation?.({ treeId: 'tree-1', event: { type: 'removed', path: '/tmp/workspace/README.md' } })
    })

    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.select_file'))
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('refresh does not re-read content for non-source-viewable selections (e.g. PDF)', async () => {
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.refresh' }))

    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(mocks.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled()
    expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-refresh-key', '0')
  })
})
