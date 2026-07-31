import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type React from 'react'
import { type PropsWithChildren, useEffect, useRef, useState } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { loggerService } from '@logger'
import type * as ChatPrimitives from '@renderer/components/chat/primitives'
import { useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { createFilePathHandle, type SerializedTreeNode } from '@shared/utils/file'

import ArtifactPane, {
  ARTIFACT_PREVIEW_MAX_SIZE_BYTES,
  ArtifactPaneView,
  getArtifactPaneSelectionPath,
  resolveArtifactPaneFileSelection
} from '../ArtifactPane'
import { ARTIFACT_MISSING_WORKSPACE_TREE_OPTIONS, useArtifactFileTreeModel } from '../useArtifactFileTreeModel'

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
      headerVariant="pane"
      paneTitle="Files"
      paneActions={<button type="button">Panel action</button>}
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

function EditablePaneInner({ workspacePath }: { workspacePath: string }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [editMode, setEditMode] = useState<'preview' | 'edit'>('preview')
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
  const editPath =
    editMode === 'edit' && selectedFile
      ? getArtifactPaneSelectionPath({ workspacePath, filePath: selectedFile })
      : undefined
  const fileSession = useFileEditSession(editPath ? createFilePathHandle(editPath) : undefined)

  return (
    <ArtifactPaneView
      workspacePath={workspacePath}
      enableFileSearch
      model={model}
      selectedFile={selectedFile}
      onSelectedFileChange={(file) => {
        setEditMode('preview')
        setSelectedFile(file)
      }}
      searchKeyword={searchKeyword}
      onSearchKeywordChange={setSearchKeyword}
      fileSession={fileSession}
      editMode={editMode}
      onEditModeChange={setEditMode}
    />
  )
}

// A fresh SWR cache per render so file content never bleeds across tests.
function EditablePaneHarness({ workspacePath }: { workspacePath: string }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EditablePaneInner workspacePath={workspacePath} />
    </SWRConfig>
  )
}

it('watches an allowed missing workspace without limiting discovery depth', () => {
  expect(ARTIFACT_MISSING_WORKSPACE_TREE_OPTIONS).toEqual({ watchMissingRoot: true })
})

const mocks = vi.hoisted(() => ({
  treeCreate: vi.fn(),
  treeDispose: vi.fn(),
  treeOnMutation: vi.fn(),
  ipcRequest: vi.fn(),
  fsReadText: vi.fn(),
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
  filePreviewProps: [] as Array<{
    filePath: string
    refreshKey: number
    type?: string
  }>,
  nextTreeId: 0,
  useRealCodeEditor: false,
  codeEditorRef: null as null | {
    getContent?: () => string
    insertText?: (text: string) => boolean
  }
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

function binaryReadResult(content: Uint8Array) {
  return {
    content,
    mime: 'text/plain',
    version: { mtime: 1, size: content.byteLength }
  }
}

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@cherrystudio/ui', async (importActual) => {
  const actual = await importActual<typeof CherryStudioUi>()
  const RealCodeEditor = actual.CodeEditor

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
    CodeEditor: (props: React.ComponentProps<typeof RealCodeEditor>) => {
      const ref = useRef<NonNullable<typeof mocks.codeEditorRef>>(null)
      useEffect(() => {
        mocks.codeEditorRef = ref.current
      })

      if (mocks.useRealCodeEditor) return <RealCodeEditor {...props} ref={ref} />

      return (
        <textarea
          data-testid="code-editor"
          data-font-size={props.fontSize}
          readOnly={props.editable === false}
          value={props.value}
          onChange={(event) => props.onChange?.(event.currentTarget.value)}
        />
      )
    },
    ConfirmDialog: ({
      cancelText,
      confirmText,
      description,
      onConfirm,
      onOpenChange,
      open,
      title
    }: {
      cancelText?: string
      confirmText?: string
      description?: React.ReactNode
      onConfirm?: () => void | Promise<void>
      onOpenChange?: (open: boolean) => void
      open?: boolean
      title: React.ReactNode
    }) =>
      open ? (
        <div role="dialog">
          <div>{title}</div>
          <div>{description}</div>
          <button type="button" onClick={() => onOpenChange?.(false)}>
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() =>
              void Promise.resolve(onConfirm?.()).then(() => {
                onOpenChange?.(false)
              })
            }>
            {confirmText}
          </button>
        </div>
      ) : null,
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

vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: (props: { filePath: string; refreshKey: number; type?: string }) => {
    mocks.filePreviewProps.push(props)
    return (
      <div
        data-testid="file-preview"
        data-file-path={props.filePath}
        data-refresh-key={props.refreshKey}
        data-preview-type={props.type}>
        {props.filePath}
      </div>
    )
  }
}))

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

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    // `useIsTextFile` / `useFileSize` read live metadata through `file.get_metadata`; route it to the
    // existing `getMetadata` mock so per-test size/type overrides keep driving the preview gates, and
    // `mocks.ipcRequest` stays reserved for the read/write routes its per-test queues expect.
    request: (route: string, input: unknown) =>
      route === 'file.get_metadata' ? mocks.getMetadata(input) : mocks.ipcRequest(route, input)
  }
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
    mocks.ipcRequest.mockReset()
    mocks.filePreviewProps.length = 0
    mocks.nextTreeId = 0
    mocks.useRealCodeEditor = false
    mocks.codeEditorRef = null
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
    // Default: tiny text files. `getMetadata().type` drives text detection
    // (via useIsTextFile) and `.size` drives the size gate — override per-test
    // for binary / large-file cases.
    mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 1024, type: 'text' })
    mocks.createObjectURL.mockReturnValue('blob:fake-url')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          openPath: mocks.openPath,
          showInFolder: mocks.showInFolder,
          isDirectory: mocks.isDirectory,
          listDirectory: mocks.listDirectory,
          listDirectoryEntries: mocks.listDirectoryEntries
        },
        fs: {
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

  it('rejects a workspace-relative artifact when the workspace path is relative', () => {
    expect(resolveArtifactPaneFileSelection('relative/workspace', 'report.md')).toBeNull()
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

  it('delegates selected files to the canonical file preview', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))

    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/README.md')
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-preview-type', 'artifact')
  })

  it('shows the ready empty state when no workspace path is available', () => {
    render(<ArtifactPane />)

    expect(mocks.treeCreate).not.toHaveBeenCalled()
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.description')
  })

  it('shows a localized invalid-path state without requesting the filesystem', async () => {
    render(
      <ArtifactPane
        workspacePath="relative/workspace"
        previewFileSelection={{ workspacePath: 'relative/workspace', filePath: 'report.md' }}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.tree_error.invalid_path.title')
    )
    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'agent.preview_pane.tree_error.invalid_path.description'
    )
    expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in Finder' })).not.toBeInTheDocument()
    expect(mocks.treeCreate).not.toHaveBeenCalled()
    expect(mocks.listDirectoryEntries).not.toHaveBeenCalled()
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

  it('uses one pane header for the file tree and selected-file preview', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.fsReadText.mockResolvedValue('# Header')

    render(<PersistentArtifactPaneHarness workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())
    expect(screen.getAllByTestId('artifact-pane-header')).toHaveLength(1)
    expect(screen.getByTestId('artifact-pane-header')).toHaveClass('bg-card')
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('Files')
    expect(screen.queryByRole('button', { name: 'agent.preview_pane.close' })).toBeNull()
    expect(screen.queryByTestId('file-tree-search-toolbar')).toBeNull()

    fireEvent.click(screen.getByTestId('tree-node-README.md'))

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    expect(screen.getAllByTestId('artifact-pane-header')).toHaveLength(1)
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('README.md')
    expect(overlay.firstElementChild).not.toHaveClass('h-10')
    expect(
      within(screen.getByTestId('artifact-pane-header')).getByRole('button', { name: 'Open in Finder' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))

    expect(screen.queryByTestId('artifact-file-preview-overlay')).toBeNull()
    expect(screen.getByTestId('artifact-pane-header-title')).toHaveTextContent('Files')
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
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/README.md')
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
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-file-path', '/Users/suyao/Desktop/记忆商人.md')
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

  it('refreshes the overlay file tree and the selected file preview', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])
    mocks.listDirectoryEntries
      .mockResolvedValueOnce([{ path: '/tmp/workspace/src/old.md', isDirectory: false }])
      .mockResolvedValueOnce([
        { path: '/tmp/workspace/src/old.md', isDirectory: false },
        { path: '/tmp/workspace/src/new.md', isDirectory: false }
      ])
    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch />)

    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/old.md'))
    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-refresh-key', '0')

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )

    await waitFor(() => expect(screen.getByTestId('tree-node-src/new.md')).toBeInTheDocument())
    expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument()
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-refresh-key', '1')
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
    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src'))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/old.md'))
    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/src/old.md')

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )
    await waitFor(() => expect(mocks.listDirectoryEntries).toHaveBeenCalledTimes(2))

    expect(screen.getByTestId('tree-node-src/old.md')).toBeInTheDocument()
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-refresh-key', '1')

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
    render(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch fileTreeSearchKeyword="deep" />)

    await waitFor(() =>
      expect(mocks.listDirectoryEntries).toHaveBeenCalledWith(
        '/tmp/workspace',
        expect.objectContaining({ recursive: true, searchPattern: 'deep', maxEntries: 200 })
      )
    )
    await waitFor(() => expect(screen.getByTestId('tree-node-src/feature/deep-result.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/feature/deep-result.ts'))

    expect(await screen.findByTestId('file-preview')).toHaveAttribute(
      'data-file-path',
      '/tmp/workspace/src/feature/deep-result.ts'
    )
  })

  it('keeps a selected search-only deep file when search is cleared', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
    mocks.listDirectoryEntries.mockResolvedValueOnce([
      { path: '/tmp/workspace/src/feature/deep-result.ts', isDirectory: false }
    ])
    const { rerender } = render(
      <ArtifactPane workspacePath="/tmp/workspace" enableFileSearch fileTreeSearchKeyword="deep" />
    )

    await waitFor(() => expect(screen.getByTestId('tree-node-src/feature/deep-result.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/feature/deep-result.ts'))

    expect(await screen.findByTestId('file-preview')).toHaveAttribute(
      'data-file-path',
      '/tmp/workspace/src/feature/deep-result.ts'
    )

    rerender(<ArtifactPane workspacePath="/tmp/workspace" enableFileSearch fileTreeSearchKeyword="" />)

    expect(screen.queryByTestId('tree-node-src/feature/deep-result.ts')).not.toBeInTheDocument()
    expect(screen.getByTestId('file-preview')).toHaveAttribute(
      'data-file-path',
      '/tmp/workspace/src/feature/deep-result.ts'
    )
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

  it('logs directory listing errors and displays a localized load-error state', async () => {
    const error = new Error('Permission denied')
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    mocks.treeCreate.mockRejectedValueOnce(error)

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.tree_error.load_error.title')
    )
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.tree_error.load_error.description')
    expect(screen.queryByText('Permission denied')).not.toBeInTheDocument()
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent('agent.preview_pane.empty.title')
    expect(errorSpy).toHaveBeenCalledWith('Failed to create directory tree for /tmp/workspace', error)
  })

  it('does not render the workspace opener without a workspace path', () => {
    render(<ArtifactPane />)

    expect(screen.queryByRole('button', { name: 'Open in Finder' })).not.toBeInTheDocument()
  })

  it('does not read content when a folder node is selected', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-__workspace_root__')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-__workspace_root__'))
    fireEvent.click(screen.getByTestId('tree-node-src'))

    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('keeps returned directory entries as folders with real child files', async () => {
    mockWorkspaceTree('/tmp/workspace', ['src', 'src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    expect(screen.getByTestId('tree-node-src')).toHaveAttribute('data-kind', 'folder')
    expect(screen.getByTestId('tree-node-src/index.ts')).toHaveAttribute('data-kind', 'file')

    fireEvent.click(screen.getByTestId('tree-node-src'))
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/src/index.ts')
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-preview-type', 'artifact')
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

    render(<ArtifactPane workspacePath="/Users/me/dev" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument())

    expect(screen.getByTestId('tree-node-src')).toHaveAttribute('data-kind', 'folder')
    expect(screen.getByTestId('tree-node-src/index.ts')).toHaveAttribute('data-kind', 'file')
    expect(screen.queryByTestId('tree-node-Users')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-file-path', '/Users/me/dev/src/index.ts')
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-preview-type', 'artifact')
  })

  it('autosaves an oversized in-memory draft — the size cap gates loading for edit, not writing', async () => {
    const oversizedDraft = '你'.repeat(Math.floor(ARTIFACT_PREVIEW_MAX_SIZE_BYTES / 3) + 1)
    const oversizedDraftBytes = new Blob([oversizedDraft]).size
    expect(oversizedDraftBytes).toBeGreaterThan(ARTIFACT_PREVIEW_MAX_SIZE_BYTES)
    let diskSize = 1024
    let resolveOversizedMetadata!: (value: { kind: 'file'; size: number; type: string }) => void
    mocks.getMetadata.mockImplementation(() =>
      diskSize > ARTIFACT_PREVIEW_MAX_SIZE_BYTES
        ? new Promise((resolve) => {
            resolveOversizedMetadata = resolve
          })
        : Promise.resolve({ kind: 'file', size: diskSize, type: 'text' })
    )
    mockWorkspaceTree('/tmp/workspace', ['draft.md'])
    mocks.fsReadText.mockResolvedValue('# small')
    mocks.ipcRequest
      .mockResolvedValueOnce(binaryReadResult(new TextEncoder().encode('# small')))
      .mockImplementationOnce(async () => {
        diskSize = oversizedDraftBytes
        return { mtime: 2, size: oversizedDraftBytes }
      })
    mocks.useRealCodeEditor = true

    render(<EditablePaneHarness workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-draft.md')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('tree-node-draft.md'))

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    fireEvent.click(await within(overlay).findByRole('button', { name: 'common.edit' }))
    await waitFor(() => expect(mocks.codeEditorRef).not.toBeNull())
    act(() => {
      expect(mocks.codeEditorRef?.insertText?.(oversizedDraft)).toBe(true)
    })

    // The debounced autosave persists the large draft; the size cap only blocks
    // loading an already-oversized file into the editor.
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('file.write_if_unchanged', expect.anything()), {
      timeout: 3000
    })
    const writeCall = mocks.ipcRequest.mock.calls.find(([route]) => route === 'file.write_if_unchanged')
    if (!writeCall) throw new Error('Expected a file.write_if_unchanged request')
    expect((writeCall[1] as { data: Uint8Array }).data.byteLength).toBeGreaterThan(ARTIFACT_PREVIEW_MAX_SIZE_BYTES)

    // The active session stays editable even though the saved file is now too
    // large to reopen. Switching to Preview delegates the saved file back to
    // FilePreview while the edit-size metadata refresh is still pending.
    await waitFor(() => expect(mocks.getMetadata.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(mocks.codeEditorRef).not.toBeNull()
    mocks.fsReadText.mockClear()
    fireEvent.click(within(overlay).getByRole('button', { name: 'common.preview' }))

    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/draft.md')
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-preview-type', 'artifact')
    expect(mocks.fsReadText).not.toHaveBeenCalled()

    await act(async () => {
      resolveOversizedMetadata({ kind: 'file', size: oversizedDraftBytes, type: 'text' })
    })
  })

  it('keeps the editor writable and disables discard while a failed save retry is running', async () => {
    let resolveRetry!: (value: { mtime: number; size: number }) => void
    mockWorkspaceTree('/tmp/workspace', ['draft.md'])
    mocks.fsReadText.mockResolvedValue('# small')
    mocks.ipcRequest
      .mockResolvedValueOnce(binaryReadResult(new TextEncoder().encode('# small')))
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveRetry = resolve)))
      .mockResolvedValueOnce({ mtime: 3, size: 12 })

    render(<EditablePaneHarness workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-draft.md')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('tree-node-draft.md'))

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    fireEvent.click(await within(overlay).findByRole('button', { name: 'common.edit' }))
    const editor = await within(overlay).findByTestId('code-editor')
    fireEvent.change(editor, { target: { value: 'unsaved' } })

    const alert = await within(overlay).findByRole('alert', undefined, { timeout: 3000 })
    fireEvent.click(within(alert).getByRole('button', { name: 'common.retry' }))

    await waitFor(() =>
      expect(within(alert).getByRole('button', { name: 'agent.preview_pane.edit.discard' })).toBeDisabled()
    )
    expect(editor).not.toHaveAttribute('readonly')
    fireEvent.change(editor, { target: { value: 'queued edit' } })
    expect(editor).toHaveValue('queued edit')

    await act(async () => {
      resolveRetry({ mtime: 2, size: 7 })
    })
    await waitFor(() =>
      expect(mocks.ipcRequest.mock.calls.filter(([route]) => route === 'file.write_if_unchanged')).toHaveLength(3)
    )
  })

  it('edits at 14px and preserves UTF-8 BOM and CRLF when saving', async () => {
    const encoded = new TextEncoder().encode('first\r\nsecond\r\n')
    const source = new Uint8Array(encoded.length + 3)
    source.set([0xef, 0xbb, 0xbf])
    source.set(encoded, 3)
    mockWorkspaceTree('/tmp/workspace', ['notes.txt'])
    mocks.fsReadText.mockResolvedValue('first\r\nsecond\r\n')
    mocks.ipcRequest
      .mockResolvedValueOnce(binaryReadResult(source))
      .mockResolvedValueOnce({ mtime: 2, size: source.byteLength })
    mocks.useRealCodeEditor = true

    render(<EditablePaneHarness workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-notes.txt')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('tree-node-notes.txt'))

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    fireEvent.click(await within(overlay).findByRole('button', { name: 'common.edit' }))

    await waitFor(() => expect(mocks.codeEditorRef).not.toBeNull())
    expect(document.querySelector('.code-editor')).toHaveStyle({ fontSize: '14px' })
    expect(mocks.codeEditorRef?.getContent?.()).toBe('first\nsecond\n')

    act(() => {
      expect(mocks.codeEditorRef?.insertText?.('changed\ncontent\n')).toBe(true)
    })

    // Autosave (debounced) writes without a manual save button.
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('file.write_if_unchanged', expect.anything()), {
      timeout: 3000
    })
    const writeCall = mocks.ipcRequest.mock.calls.find(([route]) => route === 'file.write_if_unchanged')
    if (!writeCall) throw new Error('Expected a file.write_if_unchanged request')
    const writeInput = writeCall[1] as {
      data: Uint8Array
      expectedVersion: { mtime: number; size: number }
      handle: { kind: 'path'; path: string }
    }
    expect(writeInput.handle).toEqual({ kind: 'path', path: '/tmp/workspace/notes.txt' })
    expect(writeInput.expectedVersion).toEqual({ mtime: 1, size: source.byteLength })
    const written = writeInput.data
    expect(Array.from(written.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const writtenText = new TextDecoder().decode(written.slice(3))
    expect(writtenText).toContain('changed\r\ncontent\r\n')
    expect(writtenText).toContain('first\r\nsecond\r\n')
    expect(writtenText.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('keeps a failed agent draft visible and supports quick discard', async () => {
    mockWorkspaceTree('/tmp/workspace', ['notes.txt'])
    mocks.fsReadText.mockResolvedValue('first\n')
    mocks.ipcRequest
      .mockResolvedValueOnce(binaryReadResult(new TextEncoder().encode('first\n')))
      .mockRejectedValueOnce(new Error('disk full'))

    render(<EditablePaneHarness workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-notes.txt')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('tree-node-notes.txt'))

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    fireEvent.click(await within(overlay).findByRole('button', { name: 'common.edit' }))
    fireEvent.change(await screen.findByTestId('code-editor'), { target: { value: 'unsaved draft\n' } })

    const saveFailure = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(saveFailure).toHaveTextContent('agent.preview_pane.edit.save_failed')
    expect(screen.getByTestId('code-editor')).toHaveValue('unsaved draft\n')

    fireEvent.click(within(saveFailure).getByRole('button', { name: 'agent.preview_pane.edit.discard' }))

    await waitFor(() => expect(screen.getByTestId('code-editor')).toHaveValue('first\n'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers to reload the latest file after a stale write is rejected', async () => {
    mockWorkspaceTree('/tmp/workspace', ['notes.txt'])
    mocks.fsReadText.mockResolvedValue('first\n')
    mocks.ipcRequest
      .mockResolvedValueOnce(binaryReadResult(new TextEncoder().encode('first\n')))
      .mockRejectedValueOnce(new IpcError(fileErrorCodes.STALE_VERSION, 'stale'))
      // First read verifies the stale write really diverged; second serves the reload.
      .mockResolvedValueOnce(binaryReadResult(new TextEncoder().encode('external\n')))
      .mockResolvedValueOnce(binaryReadResult(new TextEncoder().encode('external\n')))

    render(<EditablePaneHarness workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-notes.txt')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('tree-node-notes.txt'))

    const overlay = await screen.findByTestId('artifact-file-preview-overlay')
    fireEvent.click(await within(overlay).findByRole('button', { name: 'common.edit' }))
    fireEvent.change(await screen.findByTestId('code-editor'), { target: { value: 'draft\n' } })

    // Autosave hits the stale-version guard and opens the reload dialog.
    const conflictDialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
    expect(conflictDialog).toHaveTextContent('agent.preview_pane.edit.conflict.title')
    fireEvent.click(within(conflictDialog).getByRole('button', { name: 'agent.preview_pane.edit.conflict.reload' }))

    await waitFor(() => expect(screen.getByTestId('code-editor')).toHaveValue('external\n'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clears the preview overlay when the watcher reports the file was removed', async () => {
    mockWorkspaceTree('/tmp/workspace', ['README.md'])
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
    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-file-path', '/tmp/workspace/README.md')

    await waitFor(() => expect(pushMutation).toBeDefined())
    act(() => {
      pushMutation?.({ treeId: 'tree-1', event: { type: 'removed', path: '/tmp/workspace/README.md' } })
    })

    await waitFor(() => expect(screen.queryByTestId('artifact-file-preview-overlay')).not.toBeInTheDocument())
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()
  })

  it('refreshes every selected file through the canonical preview contract', async () => {
    mockWorkspaceTree('/tmp/workspace', ['paper.pdf'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))
    expect(await screen.findByTestId('file-preview')).toHaveAttribute('data-refresh-key', '0')

    fireEvent.click(
      within(screen.getByTestId('artifact-file-preview-overlay')).getByRole('button', {
        name: 'agent.preview_pane.refresh'
      })
    )

    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-refresh-key', '1')
  })
})
