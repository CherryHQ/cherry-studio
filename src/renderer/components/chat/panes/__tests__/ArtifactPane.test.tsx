import { loggerService } from '@logger'
import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import type { SerializedTreeNode } from '@shared/utils/file'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { type PropsWithChildren, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ArtifactPane, { ArtifactPaneView, resolveArtifactPaneFileSelection } from '../ArtifactPane'
import { useArtifactFileTreeModel } from '../useArtifactFileTreeModel'

/** Mimics the agent pane's single Viewport while its docked/maximized layout changes. */
function PersistentArtifactPaneHarness({ workspacePath }: { workspacePath: string }) {
  const [maximized, setMaximized] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [searchKeyword, setSearchKeyword] = useState('')
  const model = useArtifactFileTreeModel({
    workspacePath,
    treeOpen: true,
    expandedIds,
    searchKeyword,
    enableFileSearch: true,
    selectedFile,
    onExpandedIdsChange: setExpandedIds
  })
  const view = (
    <ArtifactPaneView
      workspacePath={workspacePath}
      enableFileSearch
      model={model}
      selectedFile={selectedFile}
      onSelectedFileChange={setSelectedFile}
      searchKeyword={searchKeyword}
      onSearchKeywordChange={setSearchKeyword}
    />
  )
  return (
    <div>
      <button type="button" data-testid="toggle-max" onClick={() => setMaximized((value) => !value)}>
        toggle
      </button>
      <div data-testid={maximized ? 'maximized-layout' : 'docked-layout'}>{view}</div>
    </div>
  )
}

const mocks = vi.hoisted(() => ({
  treeCreate: vi.fn(),
  treeDispose: vi.fn(),
  treeOnMutation: vi.fn(),
  fsRead: vi.fn(),
  fsReadText: vi.fn(),
  isTextFile: vi.fn(),
  isDirectory: vi.fn(),
  listDirectory: vi.fn(),
  listDirectoryEntries: vi.fn(),
  getMetadata: vi.fn(),
  openPath: vi.fn(),
  showInFolder: vi.fn(),
  windowOpen: vi.fn(),
  toastError: vi.fn(),
  externalApps: [] as Array<{
    id: 'vscode' | 'cursor' | 'zed'
    name: string
    protocol: string
    tags: string[]
    path: string
  }>,
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  pdfPreviewPanelProps: [] as Array<{
    fileName: string
    filePath: string
    refreshKey: number
  }>,
  officePreviewPanelProps: [] as Array<{
    filePath: string
    fileName?: string
    sourceFilePath?: string
    sourceSize?: number
    refreshKey?: number
  }>,
  officePreviewPanelModuleLoadCount: 0,
  pdfPreviewPanelModuleLoadCount: 0,
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
    ButtonGroup: ({
      children,
      ...props
    }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'> & { attached?: boolean }>) => {
      const domProps = { ...props }
      delete domProps.attached
      return <div {...domProps}>{children}</div>
    },
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
    ),
    ImagePreviewTrigger: ({
      item,
      alt,
      className,
      onError
    }: {
      item: { id: string; src: string; alt?: string; title?: string }
      alt?: string
      className?: string
      onError?: () => void
    }) => (
      <img
        data-testid="image-preview"
        data-src={item.src}
        src={item.src}
        alt={alt}
        className={className}
        onError={onError}
      />
    ),
    EmptyState: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="empty-state">
        <span>{title}</span>
        <span>{description}</span>
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

vi.mock('@renderer/components/chat/primitives', async (importActual) => ({
  ...(await importActual<typeof ChatPrimitives>()),
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ rows }: { rows?: number }) => <div data-testid="loading-state" data-rows={rows} />
}))

vi.mock('@renderer/components/ArtifactPreview/office/OfficePreviewPanel', () => {
  mocks.officePreviewPanelModuleLoadCount += 1
  return {
    default: (props: {
      filePath: string
      fileName?: string
      sourceFilePath?: string
      sourceSize?: number
      refreshKey?: number
    }) => {
      mocks.officePreviewPanelProps.push(props)
      return (
        <div
          data-testid="office-preview-panel"
          data-file-name={props.fileName}
          data-file-path={props.filePath}
          data-refresh-key={props.refreshKey}
        />
      )
    },
    __esModule: true
  }
})

vi.mock('@renderer/components/FileTree', () => ({
  FileTree: ({
    nodes,
    expandedIds,
    onExpandedChange,
    selectedId,
    onSelectedChange,
    getMenuItems,
    ...props
  }: {
    nodes: MockFileTreeNode[]
    expandedIds?: ReadonlySet<string>
    onExpandedChange?: (ids: ReadonlySet<string>) => void
    selectedId?: string | null
    onSelectedChange?: (id: string | null) => void
    getMenuItems?: (
      node: MockFileTreeNode
    ) => ReadonlyArray<
      { type: 'item'; id: string; label: string; icon?: React.ReactNode; onSelect: () => void } | { type: 'separator' }
    >
    searchToolbar?: React.ReactNode
    searchClearLabel?: string
    searchKeyword?: string
    onSearchKeywordChange?: (keyword: string) => void
    truncateLabels?: boolean
  }) => {
    const [menuNode, setMenuNode] = useState<MockFileTreeNode | null>(null)
    const renderNode = (node: MockFileTreeNode) => (
      <div key={node.id}>
        <button
          type="button"
          data-testid={`tree-node-${node.id}`}
          data-kind={node.kind}
          data-expanded={String(expandedIds?.has(node.id) ?? false)}
          data-selected={String(selectedId === node.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenuNode(node)
          }}
          onClick={() => {
            if (node.kind === 'folder') {
              const next = new Set(expandedIds ?? [])
              if (next.has(node.id)) next.delete(node.id)
              else next.add(node.id)
              onExpandedChange?.(next)
            } else {
              onSelectedChange?.(node.id)
            }
          }}>
          {node.name}
        </button>
        {node.children?.map(renderNode)}
      </div>
    )

    return (
      <div data-testid="file-tree" data-truncate-labels={String(props.truncateLabels)}>
        {props.searchToolbar ? <div data-testid="file-tree-search-toolbar">{props.searchToolbar}</div> : null}
        {props.searchKeyword ? (
          <button
            type="button"
            aria-label={props.searchClearLabel ?? 'Clear search'}
            onClick={() => props.onSearchKeywordChange?.('')}>
            clear
          </button>
        ) : null}
        {nodes.map(renderNode)}
        {menuNode ? (
          <div role="menu" data-testid="file-tree-context-menu">
            {getMenuItems?.(menuNode).map((item, index) =>
              item.type === 'item' ? (
                <button key={item.id} type="button" role="menuitem" onClick={item.onSelect}>
                  {item.icon ? <span data-testid={`menuitem-icon-${item.id}`}>{item.icon}</span> : null}
                  {item.label}
                </button>
              ) : (
                <hr key={`separator-${index}`} />
              )
            )}
          </div>
        ) : null}
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

vi.mock('@renderer/components/ArtifactPreview/pdf/PdfPreviewPanel', () => {
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

vi.mock('@renderer/components/icons/SvgIcon', () => ({
  FinderIcon: (props: React.SVGProps<SVGSVGElement>) => <svg aria-hidden="true" data-testid="finder-icon" {...props} />
}))

vi.mock('@renderer/utils/platform', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: () => ({ data: mocks.externalApps })
}))

vi.mock('@renderer/utils/editor', () => ({
  buildEditorUrl: (app: { id: string }, path: string) => `editor://${app.id}${path}`,
  getEditorIcon: (app: { id: string }) => <span aria-hidden="true">{app.id}</span>
}))

vi.mock('@renderer/components/icons/EditorIcon', () => ({
  getEditorIcon: (app: { id: string }) => <span aria-hidden="true">{app.id}</span>
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
    mocks.pdfPreviewPanelProps.length = 0
    mocks.officePreviewPanelProps.length = 0
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
    mocks.listDirectory.mockResolvedValue([])
    mocks.listDirectoryEntries.mockResolvedValue([])
    mocks.openPath.mockResolvedValue(undefined)
    mocks.showInFolder.mockResolvedValue(undefined)
    mocks.externalApps = []
    mocks.isDirectory.mockResolvedValue(false)
    // Default: tests select text files; override per-test for binary cases.
    mocks.isTextFile.mockResolvedValue(true)
    // Default: tests use tiny files; override per-test to exercise the size gate.
    mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 1024 })
    mocks.createObjectURL.mockReturnValue('blob:fake-url')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          openPath: mocks.openPath,
          showInFolder: mocks.showInFolder,
          isTextFile: mocks.isTextFile,
          isDirectory: mocks.isDirectory,
          listDirectory: mocks.listDirectory,
          listDirectoryEntries: mocks.listDirectoryEntries,
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
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: mocks.windowOpen
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: mocks.toastError }
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
    vi.useRealTimers()
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

    await waitFor(() =>
      expect(mocks.treeCreate).toHaveBeenCalledWith('/tmp/workspace', expect.objectContaining({ maxDepth: 3 }))
    )
  })

  it('keeps a single workspace tree across Viewport layout changes', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    render(<PersistentArtifactPaneHarness workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(mocks.treeCreate).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('docked-layout')).toBeInTheDocument()

    // Layout changes around the stable Viewport; the artifact subtree keeps
    // its identity and its directory-tree subscription.
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-max'))
    })
    await waitFor(() => expect(screen.getByTestId('maximized-layout')).toBeInTheDocument())

    // Minimize back to the docked slot.
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-max'))
    })
    await waitFor(() => expect(screen.getByTestId('docked-layout')).toBeInTheDocument())

    expect(mocks.treeCreate).toHaveBeenCalledTimes(1)
    expect(mocks.treeDispose).not.toHaveBeenCalled()
  })

  it('loads deeper directory children when folders are expanded', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([
        { path: '/tmp/workspace/src/deep', isDirectory: true },
        { path: '/tmp/workspace/src/notes.md', isDirectory: false }
      ])
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/deep/file.ts', isDirectory: false }])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))

    await waitFor(() =>
      expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
        '/tmp/workspace/src',
        expect.objectContaining({ recursive: false, includeFiles: true, includeDirectories: true })
      )
    )
    await waitFor(() => expect(screen.getByTestId('tree-node-src/deep')).toBeInTheDocument())
    expect(screen.getByTestId('tree-node-src/notes.md')).toBeInTheDocument()
    // Single batched listing per expand — no follow-up isDirectory IPC.
    expect(mocks.isDirectory).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('tree-node-src/deep'))

    await waitFor(() =>
      expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
        '/tmp/workspace/src/deep',
        expect.objectContaining({ recursive: false, includeFiles: true, includeDirectories: true })
      )
    )
    await waitFor(() => expect(screen.getByTestId('tree-node-src/deep/file.ts')).toBeInTheDocument())
  })

  it('ignores stale lazy directory results after the workspace changes', async () => {
    let resolveListDirectory: (entries: Array<{ path: string; isDirectory: boolean }>) => void = () => undefined
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mockWorkspaceTree('/tmp/workspace/src', [])
    mockWorkspaceTree('/tmp/other-workspace', ['src/other.ts'])
    mocks.listDirectoryEntries.mockReturnValueOnce(
      new Promise<Array<{ path: string; isDirectory: boolean }>>((resolve) => {
        resolveListDirectory = resolve
      })
    )

    const { rerender } = render(<PersistentArtifactPaneHarness workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() =>
      expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
        '/tmp/workspace/src',
        expect.objectContaining({ recursive: false, includeFiles: true, includeDirectories: true })
      )
    )

    rerender(<PersistentArtifactPaneHarness workspacePath="/tmp/other-workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src/other.ts')).toBeInTheDocument())

    await act(async () => {
      resolveListDirectory([{ path: '/tmp/workspace/src/stale.ts', isDirectory: false }])
    })

    expect(screen.queryByTestId('tree-node-src/stale.ts')).not.toBeInTheDocument()
  })

  it('clears loaded lazy directory children after the workspace changes', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mockWorkspaceTree('/tmp/workspace/src', [])
    mockWorkspaceTree('/tmp/other-workspace', ['src/other.ts'])
    mockWorkspaceTree('/tmp/other-workspace/src', [])
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/old.md', isDirectory: false }])
      .mockResolvedValueOnce([{ path: '/tmp/other-workspace/src/fresh.md', isDirectory: false }])

    const { rerender } = render(<PersistentArtifactPaneHarness workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument())

    rerender(<PersistentArtifactPaneHarness workspacePath="/tmp/other-workspace" />)

    await waitFor(() =>
      expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
        '/tmp/other-workspace/src',
        expect.objectContaining({ recursive: false, includeFiles: true, includeDirectories: true })
      )
    )
    await waitFor(() => expect(screen.getByTestId('tree-node-src/fresh.md')).toBeInTheDocument())
    expect(screen.queryByTestId('tree-node-src/old.md')).not.toBeInTheDocument()
  })

  it('reloads lazy directory children when the file tree is refreshed', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/old.md', isDirectory: false }])
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/new.md', isDirectory: false }])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.refresh' }))

    await waitFor(() => expect(screen.getByTestId('tree-node-src/new.md')).toBeInTheDocument())
    expect(screen.queryByTestId('tree-node-src/old.md')).not.toBeInTheDocument()
  })

  it('opens file previews in an overlay and clears selection when closed', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValue('# Overlay')

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    expect(overlay).toHaveTextContent('README.md')
    expect(overlay.firstElementChild).toHaveClass('h-10', 'pl-3', 'pr-2')
    expect(overlay.firstElementChild).not.toHaveClass('px-3')
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Overlay'))
    expect(screen.getByTestId('tree-node-README.md')).toHaveAttribute('data-selected', 'true')

    const openButton = within(overlay).getByRole('button', { name: 'Open in Finder' })
    const refreshButton = within(overlay).getByRole('button', { name: 'agent.preview_pane.refresh' })
    const closeButton = within(overlay).getByRole('button', { name: 'agent.preview_pane.close' })
    expect(refreshButton).toBeInTheDocument()
    expect(closeButton).toBeInTheDocument()
    expect(openButton.compareDocumentPosition(refreshButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(refreshButton.compareDocumentPosition(closeButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.click(openButton)
    await waitFor(() => expect(mocks.showInFolder).toHaveBeenCalledWith('/tmp/workspace/README.md'))

    fireEvent.click(within(overlay).getByRole('button', { name: 'agent.preview_pane.close' }))

    expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('tree-node-README.md')).toHaveAttribute('data-selected', 'false')
  })

  it('renders an external preview selection even when no workspace tree is available', async () => {
    mocks.fsReadText.mockResolvedValue('# External')

    render(
      <ArtifactPane
        previewFileSelection={{
          workspacePath: '/Users/suyao/Desktop',
          filePath: '记忆商人.md'
        }}
      />
    )

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    expect(overlay).toHaveTextContent('记忆商人.md')
    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/Users/suyao/Desktop/记忆商人.md'))
    expect(screen.getByTestId('markdown')).toHaveTextContent('# External')
    expect(mocks.treeCreate).not.toHaveBeenCalled()

    fireEvent.click(within(overlay).getByRole('button', { name: 'Open in Finder' }))
    await waitFor(() => expect(mocks.showInFolder).toHaveBeenCalledWith('/Users/suyao/Desktop/记忆商人.md'))
  })

  it('clears the standalone preview overlay when the watcher reports the selected file was removed', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValue('# Overlay')
    let pushMutation: ((payload: { treeId: string; event: { type: 'removed'; path: string } }) => void) | undefined
    mocks.treeOnMutation.mockImplementation((cb) => {
      pushMutation = cb as typeof pushMutation
      return () => {
        pushMutation = undefined
      }
    })

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    await waitFor(() => expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveTextContent('README.md'))

    await waitFor(() => expect(pushMutation).toBeDefined())
    act(() => {
      pushMutation?.({ treeId: 'tree-1', event: { type: 'removed', path: '/tmp/workspace/README.md' } })
    })

    await waitFor(() => expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument())
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('focuses the preview overlay after file-tree selection and closes it with Escape', async () => {
    const user = userEvent.setup()
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValue('# Overlay')

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    const overlay = await screen.findByTestId('artifact-file-preview-overlay')

    await waitFor(() => expect(overlay).toHaveFocus())

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('tree-node-README.md')).toHaveAttribute('data-selected', 'false')
  })

  it('shows refresh and root external-open controls in the overlay file-tree search row', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('file-tree-search-toolbar')).toBeInTheDocument())

    const toolbar = screen.getByTestId('file-tree-search-toolbar')
    expect(within(toolbar).getByRole('button', { name: 'agent.preview_pane.refresh' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Open in Finder' })).toBeInTheDocument()
  })

  it('refreshes the overlay file tree and re-reads preview content', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/old.md', isDirectory: false }])
      .mockResolvedValueOnce([
        { path: '/tmp/workspace/src/old.md', isDirectory: false },
        { path: '/tmp/workspace/src/new.md', isDirectory: false }
      ])
    mocks.fsReadText.mockResolvedValueOnce('# Old').mockResolvedValueOnce('# New')

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/old.md'))
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Old'))
    expect(mocks.fsReadText).toHaveBeenCalledTimes(1)

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )

    await waitFor(() => expect(screen.getByTestId('tree-node-src/new.md')).toBeInTheDocument())
    expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument()
    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledTimes(2))
    expect(mocks.fsReadText).toHaveBeenLastCalledWith('/tmp/workspace/src/old.md')
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# New'))
  })

  it('opens file-tree node context menu targets from workspace-relative paths', async () => {
    mocks.externalApps = [
      {
        id: 'vscode',
        name: 'VS Code',
        protocol: 'vscode://',
        tags: ['code-editor'],
        path: '/Applications/Visual Studio Code.app'
      }
    ]
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByTestId('tree-node-__workspace_root__'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Finder' }))
    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/workspace'))

    fireEvent.contextMenu(screen.getByTestId('tree-node-src'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'VS Code' }))
    expect(mocks.windowOpen).toHaveBeenCalledWith('editor://vscode/tmp/workspace/src')

    fireEvent.contextMenu(screen.getByTestId('tree-node-src/index.ts'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'agent.preview_pane.default_app' }))
    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/workspace/src/index.ts'))

    fireEvent.contextMenu(screen.getByTestId('tree-node-src/index.ts'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Finder' }))
    await waitFor(() => expect(mocks.showInFolder).toHaveBeenCalledWith('/tmp/workspace/src/index.ts'))
  })

  it('uses the Finder icon for file-manager context menu actions on macOS', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.contextMenu(screen.getByTestId('tree-node-__workspace_root__'))
    expect(within(screen.getByRole('menuitem', { name: 'Finder' })).getByTestId('finder-icon')).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByTestId('tree-node-src/index.ts'))
    expect(within(screen.getByRole('menuitem', { name: 'Finder' })).getByTestId('finder-icon')).toBeInTheDocument()
  })

  it('keeps the selected lazy file while expanded directories are refreshing', async () => {
    let resolveReload: (entries: Array<{ path: string; isDirectory: boolean }>) => void = () => undefined
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/old.md', isDirectory: false }])
      .mockReturnValueOnce(
        new Promise<Array<{ path: string; isDirectory: boolean }>>((resolve) => {
          resolveReload = resolve
        })
      )
    mocks.fsReadText.mockResolvedValue('# Old')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/old.md'))
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Old'))

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )
    await waitFor(() => expect(mocks.listDirectoryEntries).toHaveBeenCalledTimes(2))

    expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument()
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Old')

    await act(async () => {
      resolveReload([{ path: '/tmp/workspace/src/new.md', isDirectory: false }])
    })

    await waitFor(() => expect(screen.queryByTestId('tree-node-src/old.md')).not.toBeInTheDocument())
  })

  it('reloads expanded lazy directories when their watcher reports a file change', async () => {
    let pushMutation:
      | ((payload: {
          treeId: string
          event: { type: 'updated'; path: string; stats: { mtime: number; birthtime: number } }
        }) => void)
      | undefined
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/old.md', isDirectory: false }])
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/new.md', isDirectory: false }])
    mocks.treeOnMutation.mockImplementation((cb) => {
      pushMutation = cb as typeof pushMutation
      return () => {
        pushMutation = undefined
      }
    })

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument())
    await waitFor(() =>
      expect(mocks.treeCreate).toHaveBeenCalledWith('/tmp/workspace/src', expect.objectContaining({ maxDepth: 1 }))
    )

    act(() => {
      pushMutation?.({
        treeId: 'tree-default',
        event: {
          type: 'updated',
          path: '/tmp/workspace/src/old.md',
          stats: { mtime: 1, birthtime: 1 }
        }
      })
    })

    await waitFor(() => expect(screen.getByTestId('tree-node-src/new.md')).toBeInTheDocument())
    expect(screen.queryByTestId('tree-node-src/old.md')).not.toBeInTheDocument()
  })

  it('ignores older lazy directory requests when a newer reload wins', async () => {
    let pushMutation:
      | ((payload: {
          treeId: string
          event: { type: 'updated'; path: string; stats: { mtime: number; birthtime: number } }
        }) => void)
      | undefined
    let resolveInitial: (entries: Array<{ path: string; isDirectory: boolean }>) => void = () => undefined
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.listDirectoryEntries
      .mockReturnValueOnce(
        new Promise<Array<{ path: string; isDirectory: boolean }>>((resolve) => {
          resolveInitial = resolve
        })
      )
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/new.md', isDirectory: false }])
    mocks.treeOnMutation.mockImplementation((cb) => {
      pushMutation = cb as typeof pushMutation
      return () => {
        pushMutation = undefined
      }
    })

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(mocks.listDirectoryEntries).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(pushMutation).toBeDefined())

    act(() => {
      pushMutation?.({
        treeId: 'tree-default',
        event: {
          type: 'updated',
          path: '/tmp/workspace/src/new.md',
          stats: { mtime: 1, birthtime: 1 }
        }
      })
    })

    await waitFor(() => expect(screen.getByTestId('tree-node-src/new.md')).toBeInTheDocument())

    await act(async () => {
      resolveInitial([{ path: '/tmp/workspace/src/stale.md', isDirectory: false }])
    })

    expect(screen.getByTestId('tree-node-src/new.md')).toBeInTheDocument()
    expect(screen.queryByTestId('tree-node-src/stale.md')).not.toBeInTheDocument()
  })

  it('searches unloaded deep files and allows selecting the result', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.listDirectoryEntries.mockResolvedValueOnce([
      { path: '/tmp/workspace/src/feature/deep-result.ts', isDirectory: false }
    ])
    mocks.fsReadText.mockResolvedValue('export const value = 1')

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch fileTreeSearchKeyword="deep" />)

    await waitFor(() =>
      expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
        '/tmp/workspace',
        expect.objectContaining({ recursive: true, searchPattern: 'deep', maxEntries: 200 })
      )
    )
    await waitFor(() => expect(screen.getByTestId('tree-node-src/feature/deep-result.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/feature/deep-result.ts'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/src/feature/deep-result.ts'))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('export const value = 1')
  })

  it('keeps a selected search-only deep file when search is cleared', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.listDirectoryEntries.mockResolvedValueOnce([
      { path: '/tmp/workspace/src/feature/deep-result.ts', isDirectory: false }
    ])
    mocks.fsReadText.mockResolvedValue('export const value = 1')

    const { rerender } = render(
      <ArtifactPane workspacePath="/tmp/workspace" enableFileSearch fileTreeSearchKeyword="deep" />
    )

    await waitFor(() => expect(screen.getByTestId('tree-node-src/feature/deep-result.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/feature/deep-result.ts'))

    await waitFor(() => expect(screen.getByTestId('code-viewer')).toHaveTextContent('export const value = 1'))

    rerender(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch fileTreeSearchKeyword="" />)

    expect(screen.queryByTestId('tree-node-src/feature/deep-result.ts')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('export const value = 1')
    expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/src/feature/deep-result.ts')
  })

  it('debounces deep file search requests', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.listDirectoryEntries.mockResolvedValue([])

    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch fileTreeSearchKeyword="deep" />)

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(mocks.listDirectoryEntries).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
        '/tmp/workspace',
        expect.objectContaining({ recursive: true, searchPattern: 'deep', maxEntries: 200 })
      )
    )
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

  it('does not render the workspace opener without a workspace path', () => {
    render(<ArtifactPane />)

    expect(screen.queryByRole('button', { name: 'Open in Finder' })).not.toBeInTheDocument()
  })

  it('renders markdown files through the shared Markdown component', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValue('# Hello')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
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
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())
    expect(screen.getByTestId('tree-node-README.md')).toHaveAttribute('data-selected', 'true')

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    expect(onSelectedFileChange).toHaveBeenCalledWith('src/index.ts')
  })

  it('renders text file previews without wrapping so horizontal overflow can scroll', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.fsReadText.mockResolvedValue('const value = "a very long line";')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src/index.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/src/index.ts'))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('const value = "a very long line";')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-language', 'TypeScript')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-wrapped', 'false')
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveClass('overflow-hidden')
    expect(screen.getByTestId('code-viewer').parentElement).toHaveClass('overflow-auto')
  })

  it('renders HTML previews in an iframe with Popup-aligned sandbox, file base, and hidden outer overflow', async () => {
    mockWorkspaceTree('/tmp/workspace', ['index.html'])
    mocks.fsReadText.mockResolvedValue(
      '<!doctype html><html><head><title>Hello</title></head><body><a href="about.html">About</a></body></html>'
    )

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)
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
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveClass('overflow-hidden')
  })

  it('keeps empty HTML previews blank without showing the Popup empty text', async () => {
    mockWorkspaceTree('/tmp/workspace', ['empty.html'])
    mocks.fsReadText.mockResolvedValue('   ')

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-empty.html')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-empty.html'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/empty.html'))
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByText('html_artifacts.empty_preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('artifact-file-preview-overlay')).toHaveClass('overflow-hidden')
  })

  it('does not read content when a folder node is selected', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
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
    await waitFor(() => expect(screen.getByTestId('tree-node-test.md')).toBeInTheDocument())

    expect(screen.getByTestId('tree-node-__workspace_root__')).toHaveTextContent('dev')
    expect(screen.queryByTestId('tree-node-Users')).not.toBeInTheDocument()
  })

  it('keeps absolute directory entries as relative folders with real child files', async () => {
    mockWorkspaceTree('/Users/me/dev', ['/Users/me/dev/src', '/Users/me/dev/src/index.ts'])
    mocks.fsReadText.mockResolvedValue('export {}')

    render(<ArtifactPane workspacePath="/Users/me/dev" />)
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
    mockWorkspaceTree('/tmp/workspace', ['data.bin'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-data.bin')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-data.bin'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.code_unavailable')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('renders image files with ImagePreviewPanel from a file:// URL without reading content', async () => {
    mockWorkspaceTree('/tmp/workspace', ['photo.png'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(screen.getByTestId('tree-node-photo.png')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-photo.png'))

    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeInTheDocument())
    expect(screen.getByTestId('image-preview')).toHaveAttribute('data-src', 'file:///tmp/workspace/photo.png')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(mocks.isTextFile).not.toHaveBeenCalled()
  })

  it('remounts the selected image preview when refresh is clicked after a load error', async () => {
    mockWorkspaceTree('/tmp/workspace', ['photo.png'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(screen.getByTestId('tree-node-photo.png')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-photo.png'))

    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeInTheDocument())
    const failedImage = screen.getByTestId('image-preview')
    fireEvent.error(failedImage)

    await waitFor(() => expect(screen.getByText('agent.preview_pane.unavailable.title')).toBeInTheDocument())
    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )

    await waitFor(() =>
      expect(screen.getByTestId('image-preview')).toHaveAttribute('data-src', 'file:///tmp/workspace/photo.png')
    )
    expect(screen.getByTestId('image-preview')).not.toBe(failedImage)
    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(mocks.isTextFile).not.toHaveBeenCalled()
  })

  it('renders SVG files as an image preview', async () => {
    mockWorkspaceTree('/tmp/workspace', ['icon.svg'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(screen.getByTestId('tree-node-icon.svg')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-icon.svg'))

    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeInTheDocument())
    expect(screen.getByTestId('image-preview')).toHaveAttribute('data-src', 'file:///tmp/workspace/icon.svg')
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('still renders images above the 2 MB size cap', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 20 * 1024 * 1024 })
    mockWorkspaceTree('/tmp/workspace', ['huge.png'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(screen.getByTestId('tree-node-huge.png')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-huge.png'))

    await waitFor(() => expect(screen.getByTestId('image-preview')).toBeInTheDocument())
    expect(screen.queryByText('agent.preview_pane.too_large.title')).not.toBeInTheDocument()
  })

  it('does not read unknown extensions when the sniff says binary', async () => {
    mocks.isTextFile.mockResolvedValueOnce(false)
    mockWorkspaceTree('/tmp/workspace', ['archive.custom'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-archive.custom')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-archive.custom'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.code_unavailable')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('shows the file-unavailable state when the size sniff fails (missing/moved file)', async () => {
    mocks.getMetadata.mockRejectedValueOnce(new Error('ENOENT: no such file'))
    mockWorkspaceTree('/tmp/workspace', ['gone.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-gone.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-gone.ts'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.unavailable.title')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('shows the file-unavailable state when reading text content fails', async () => {
    mocks.fsReadText.mockRejectedValueOnce(new Error('EACCES: permission denied'))
    mockWorkspaceTree('/tmp/workspace', ['locked.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
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
    await waitFor(() => expect(screen.getByTestId('tree-node-notes.log')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-notes.log'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/notes.log'))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('boot at 12:00')
  })

  it('skips preview and readText for text files above the 2 MB size cap', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 3 * 1024 * 1024 })
    mockWorkspaceTree('/tmp/workspace', ['huge.json'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-huge.json')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-huge.json'))

    await waitFor(() => expect(screen.getByText('agent.preview_pane.too_large.title')).toBeInTheDocument())
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('still renders PDFs above the 2 MB size cap', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 50 * 1024 * 1024 })
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument())
    expect(screen.queryByText('agent.preview_pane.too_large.title')).not.toBeInTheDocument()
  })

  it('does not load the Office preview module while previewing regular text files', async () => {
    mockWorkspaceTree('/tmp/workspace', ['notes.log'])
    mocks.fsReadText.mockResolvedValue('boot at 12:00')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-notes.log')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-notes.log'))

    await waitFor(() => expect(screen.getByTestId('code-viewer')).toHaveTextContent('boot at 12:00'))
    expect(mocks.officePreviewPanelModuleLoadCount).toBe(0)
  })

  it.each(['report.xlsx', 'report.xlsm', 'proposal.docx', 'legacy.doc', 'legacy.xls', 'slides.ppt', 'slides.pptx'])(
    'routes Office documents to the shared preview panel for %s without reading source content',
    async (fileName) => {
      mockWorkspaceTree('/tmp/workspace', [fileName])

      render(<ArtifactPane workspacePath="/tmp/workspace" />)
      await waitFor(() => expect(screen.getByTestId(`tree-node-${fileName}`)).toBeInTheDocument())

      fireEvent.click(screen.getByTestId(`tree-node-${fileName}`))

      await waitFor(() => expect(screen.getByTestId('office-preview-panel')).toBeInTheDocument())
      expect(screen.getByTestId('office-preview-panel')).toHaveAttribute('data-file-name', fileName)
      expect(mocks.officePreviewPanelProps.at(-1)).toMatchObject({
        filePath: fileName,
        fileName,
        sourceFilePath: `/tmp/workspace/${fileName}`
      })
      expect(screen.queryByText('agent.preview_pane.code_unavailable')).not.toBeInTheDocument()
      expect(screen.queryByText('agent.preview_pane.too_large.title')).not.toBeInTheDocument()
      expect(screen.queryByTestId('pdf-preview-panel')).not.toBeInTheDocument()
      expect(mocks.fsRead).not.toHaveBeenCalled()
      expect(mocks.fsReadText).not.toHaveBeenCalled()
      expect(mocks.isTextFile).not.toHaveBeenCalledWith(`/tmp/workspace/${fileName}`)
    }
  )

  it('restarts the selected Office preview job when refresh is clicked', async () => {
    mockWorkspaceTree('/tmp/workspace', ['proposal.docx'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-proposal.docx')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-proposal.docx'))

    await waitFor(() => expect(screen.getByTestId('office-preview-panel')).toHaveAttribute('data-refresh-key', '0'))

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )

    await waitFor(() => expect(screen.getByTestId('office-preview-panel')).toHaveAttribute('data-refresh-key', '1'))
    expect(mocks.officePreviewPanelProps.at(-1)).toMatchObject({
      filePath: 'proposal.docx',
      refreshKey: 1
    })
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('renders non-markdown text files through CodeViewer with the resolved language', async () => {
    mockWorkspaceTree('/tmp/workspace', ['config.json'])
    mocks.fsReadText.mockResolvedValue('{"enabled":true}')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-config.json')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-config.json'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/config.json'))
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-language', 'JSON')
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('{"enabled":true}')
  })

  it('clears the preview overlay when the watcher reports the file was removed', async () => {
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
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Before'))

    await waitFor(() => expect(pushMutation).toBeDefined())
    act(() => {
      pushMutation?.({ treeId: 'tree-1', event: { type: 'removed', path: '/tmp/workspace/README.md' } })
    })

    await waitFor(() => expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument())
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('refresh does not re-read content for non-source-viewable selections (e.g. PDF)', async () => {
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))
    await waitFor(() => expect(screen.getByTestId('pdf-preview-panel')).toBeInTheDocument())

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )

    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(mocks.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled()
    expect(screen.getByTestId('pdf-preview-panel')).toHaveAttribute('data-refresh-key', '0')
  })
})
