import { loggerService } from '@logger'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ArtifactPane, { ARTIFACT_FILE_TREE_DEFAULT_WIDTH } from '../ArtifactPane'

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  fsRead: vi.fn(),
  fsReadText: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  artifactFileTreeWidth: null as number | null,
  setArtifactFileTreeWidth: vi.fn((width: number) => {
    mocks.artifactFileTreeWidth = width
  })
}))

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

vi.mock('@renderer/components/RichEditor', () => ({
  default: ({ initialContent }: { initialContent?: string }) => <div data-testid="rich-editor">{initialContent}</div>
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value, language, wrapped }: { value: string; language: string; wrapped?: boolean }) => (
    <div data-testid="code-viewer" data-language={language} data-wrapped={String(wrapped)}>
      {value}
    </div>
  )
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: (key: string) =>
    key === 'ui.chat.artifact_pane.file_tree.width'
      ? [mocks.artifactFileTreeWidth, mocks.setArtifactFileTreeWidth]
      : [null, vi.fn()]
}))

vi.mock('@renderer/components/Icons/SVGIcon', () => ({
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
    t: (key: string, options?: { count?: number; name?: string }) => {
      if (key === 'agent.preview_pane.items') return `${options?.count ?? 0} localized items`
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
    mocks.listDirectory.mockResolvedValue([])
    mocks.createObjectURL.mockReturnValue('blob:fake-url')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          listDirectory: mocks.listDirectory,
          openPath: vi.fn()
        },
        fs: {
          read: mocks.fsRead,
          readText: mocks.fsReadText
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

  it('shows the ready empty state when no workspace path is available', () => {
    render(<ArtifactPane />)

    expect(mocks.listDirectory).not.toHaveBeenCalled()
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.description')
  })

  it('lists the workspace directory recursively', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['README.md', 'src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() =>
      expect(mocks.listDirectory).toHaveBeenCalledWith('/tmp/workspace', {
        recursive: true,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true
      })
    )
  })

  it('logs and displays directory listing errors', async () => {
    const error = new Error('Permission denied')
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    mocks.listDirectory.mockRejectedValueOnce(error)

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    await waitFor(() => expect(screen.getByText('Permission denied')).toBeInTheDocument())
    expect(screen.getByTestId('empty-state')).toHaveTextContent('common.error')
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent('agent.preview_pane.empty.title')
    expect(errorSpy).toHaveBeenCalledWith('Failed to list directory: /tmp/workspace', error)
  })

  it('renders header tool buttons without a close button', () => {
    render(<ArtifactPane onToggleMaximized={vi.fn()} />)

    for (const label of ['agent.preview_pane.file_tree', 'agent.preview_pane.refresh', 'agent.preview_pane.maximize']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'agent.preview_pane.preview' })).toBeInTheDocument()
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

    await waitFor(() => expect(mocks.listDirectory).toHaveBeenCalledWith('/tmp/workspace', expect.any(Object)))

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

  it('defaults to preview mode with the file tree collapsed', () => {
    render(<ArtifactPane />)

    const folderButton = screen.getByRole('button', { name: 'agent.preview_pane.file_tree' })

    expect(screen.getByRole('button', { name: 'agent.preview_pane.preview' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.preview_pane.code' })).not.toBeInTheDocument()
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
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])

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
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])

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
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])

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

  it('clamps dragged file tree width from the measured artifact pane width', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])

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
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])

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
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])

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
    mocks.listDirectory.mockResolvedValueOnce(['index.html'])
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

  it('disables PDF iframe pointer events while resizing the file tree', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['paper.pdf'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))
    await waitFor(() => expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull())

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

  it('renders markdown files with RichEditor in preview mode and CodeViewer in code mode', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])
    mocks.fsReadText.mockResolvedValue('# Hello')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/README.md'))
    expect(screen.getByTestId('rich-editor')).toHaveTextContent('# Hello')

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.preview' }))
    expect(screen.queryByTestId('rich-editor')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.preview_pane.code' })).toBeInTheDocument()
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('# Hello')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-language', 'markdown')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-wrapped', 'false')
  })

  it('supports controlled selected file state', async () => {
    const onSelectedFileChange = vi.fn()
    mocks.listDirectory.mockResolvedValueOnce(['README.md', 'src/index.ts'])
    mocks.fsReadText.mockResolvedValue('# Controlled')

    render(
      <ArtifactPane
        workspacePath="/tmp/workspace"
        selectedFile="README.md"
        onSelectedFileChange={onSelectedFileChange}
      />
    )

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/README.md'))
    expect(screen.getByTestId('rich-editor')).toHaveTextContent('# Controlled')

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())
    expect(screen.getByTestId('tree-node-README.md')).toHaveAttribute('data-selected', 'true')

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    expect(onSelectedFileChange).toHaveBeenCalledWith('src/index.ts')
  })

  it('supports controlled view mode state', async () => {
    const onViewModeChange = vi.fn()
    mocks.listDirectory.mockResolvedValueOnce(['README.md'])
    mocks.fsReadText.mockResolvedValue('# Controlled')

    render(
      <ArtifactPane
        workspacePath="/tmp/workspace"
        selectedFile="README.md"
        viewMode="code"
        onViewModeChange={onViewModeChange}
      />
    )

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/README.md'))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('# Controlled')

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.code' }))

    expect(onViewModeChange).toHaveBeenCalledWith('preview')
  })

  it('requests preview mode when a controlled source-unavailable file is selected in code mode', async () => {
    const onViewModeChange = vi.fn()
    mocks.listDirectory.mockResolvedValueOnce(['paper.pdf'])

    const ControlledArtifactPane = () => {
      const [viewMode, setViewMode] = useState<'preview' | 'code'>('code')

      return (
        <ArtifactPane
          workspacePath="/tmp/workspace"
          selectedFile="paper.pdf"
          viewMode={viewMode}
          onViewModeChange={(next) => {
            onViewModeChange(next)
            setViewMode(next)
          }}
        />
      )
    }

    const { container } = render(<ControlledArtifactPane />)

    await waitFor(() => expect(onViewModeChange).toHaveBeenCalledWith('preview'))
    await waitFor(() => expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull())
    expect(screen.getByRole('button', { name: 'agent.preview_pane.preview' })).toBeDisabled()
  })

  it('renders text file previews without wrapping so horizontal overflow can scroll', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['src/index.ts'])
    mocks.fsReadText.mockResolvedValue('const value = "a very long line";')

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-src/index.ts')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-src/index.ts'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/src/index.ts'))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('const value = "a very long line";')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-language', 'typescript')
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-wrapped', 'false')
    expect(container.querySelector('section')?.children.item(1)).toHaveClass('overflow-auto')
  })

  it('renders HTML previews in an iframe with Popup-aligned sandbox and hidden outer overflow', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['index.html'])
    mocks.fsReadText.mockResolvedValue('<!doctype html><html><body><h1>Hello</h1></body></html>')

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-index.html')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-index.html'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/index.html'))
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe).toHaveAttribute('srcdoc', '<!doctype html><html><body><h1>Hello</h1></body></html>')
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    expect(iframe).toHaveAttribute('title', 'index.html')
    expect(iframe).toHaveClass('h-full', 'w-full', 'border-0', 'bg-background')
    expect(container.querySelector('section')?.children.item(1)).toHaveClass('overflow-hidden')
  })

  it('keeps empty HTML previews blank without showing the Popup empty text', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['empty.html'])
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
    mocks.listDirectory.mockResolvedValueOnce(['src/index.ts'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-__workspace_root__')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-__workspace_root__'))
    fireEvent.click(screen.getByTestId('tree-node-src'))

    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
  })

  it('keeps returned directory entries as folders with real child files', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['src', 'src/index.ts'])
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
    mocks.listDirectory.mockResolvedValueOnce(['/Users/me/dev/test.md'])

    render(<ArtifactPane workspacePath="/Users/me/dev" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-test.md')).toBeInTheDocument())

    expect(screen.getByTestId('tree-node-__workspace_root__')).toHaveTextContent('dev')
    expect(screen.queryByTestId('tree-node-Users')).not.toBeInTheDocument()
  })

  it('keeps absolute directory entries as relative folders with real child files', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['/Users/me/dev/src', '/Users/me/dev/src/index.ts'])
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

  it('renders PDF files with an iframe viewer pointing at the local file URL', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['paper.pdf'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull())
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(mocks.createObjectURL).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('file:///tmp/workspace/paper.pdf#toolbar=0')
    expect(container.querySelector('iframe')).not.toHaveAttribute('sandbox')
  })

  it('recreates the selected PDF iframe when the PDF layout refresh key changes', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['paper.pdf'])

    const { container, rerender } = render(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutRefreshKey={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull())
    const firstIframe = container.querySelector('iframe[title="paper.pdf"]')

    rerender(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutRefreshKey={1} />)

    const refreshedIframe = container.querySelector('iframe[title="paper.pdf"]')
    expect(refreshedIframe).not.toBe(firstIframe)
    expect(refreshedIframe?.getAttribute('src')).toBe('file:///tmp/workspace/paper.pdf#toolbar=0')
    expect(mocks.createObjectURL).not.toHaveBeenCalled()
    expect(refreshedIframe).not.toHaveAttribute('sandbox')
  })

  it('shows loading instead of mounting the selected PDF while PDF layout is pending', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['paper.pdf'])

    const { container, rerender } = render(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutPending />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    expect(screen.getByTestId('loading-state')).toBeInTheDocument()
    expect(container.querySelector('iframe[title="paper.pdf"]')).toBeNull()

    rerender(<ArtifactPane workspacePath="/tmp/workspace" pdfLayoutRefreshKey={1} />)

    await waitFor(() => expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull())
    expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument()
  })

  it('disables source mode switching for PDF files', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['paper.pdf'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull())
    const modeButton = screen.getByRole('button', { name: 'agent.preview_pane.preview' })
    expect(modeButton).toBeDisabled()

    fireEvent.click(modeButton)

    expect(screen.queryByRole('button', { name: 'agent.preview_pane.code' })).not.toBeInTheDocument()
    expect(screen.queryByText('agent.preview_pane.code_unavailable')).not.toBeInTheDocument()
    expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull()
  })

  it('does not read obvious binary files and disables source mode switching', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['image.png'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-image.png')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-image.png'))

    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'agent.preview_pane.preview' })).toBeDisabled()
  })

  it('does not read unknown extensions and disables source mode switching', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['archive.custom'])

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-archive.custom')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-archive.custom'))

    expect(mocks.fsReadText).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'agent.preview_pane.preview' })).toBeDisabled()
  })

  it('allows source mode switching for LANG_MAP-backed files', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['config.json'])
    mocks.fsReadText.mockResolvedValue('{"enabled":true}')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-config.json')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-config.json'))

    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledWith('/tmp/workspace/config.json'))
    const modeButton = screen.getByRole('button', { name: 'agent.preview_pane.preview' })
    expect(modeButton).not.toBeDisabled()

    fireEvent.click(modeButton)

    expect(screen.getByRole('button', { name: 'agent.preview_pane.code' })).toBeInTheDocument()
    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-language', 'json')
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('{"enabled":true}')
  })

  it('returns to preview mode when a source-unavailable file is selected from code mode', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['README.md', 'paper.pdf'])
    mocks.fsReadText.mockResolvedValue('# Hello')

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    await waitFor(() => expect(screen.getByTestId('rich-editor')).toHaveTextContent('# Hello'))

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.preview' }))
    expect(screen.getByRole('button', { name: 'agent.preview_pane.code' })).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'agent.preview_pane.preview' })).toBeDisabled())
    expect(screen.queryByRole('button', { name: 'agent.preview_pane.code' })).not.toBeInTheDocument()
    expect(screen.queryByText('agent.preview_pane.code_unavailable')).not.toBeInTheDocument()
    expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull()
  })

  it('refreshes the workspace tree and selected text file content when refresh is clicked', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['README.md']).mockResolvedValueOnce(['README.md'])
    mocks.fsReadText.mockResolvedValueOnce('# Before').mockResolvedValueOnce('# After')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    await waitFor(() => expect(screen.getByTestId('rich-editor')).toHaveTextContent('# Before'))

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.refresh' }))

    await waitFor(() => expect(mocks.listDirectory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.fsReadText).toHaveBeenCalledTimes(2))
    expect(mocks.fsReadText).toHaveBeenLastCalledWith('/tmp/workspace/README.md')
    expect(screen.getByTestId('rich-editor')).toHaveTextContent('# After')
  })

  it('clears the selected file when refresh removes it from the workspace tree', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['README.md']).mockResolvedValueOnce([])
    mocks.fsReadText.mockResolvedValueOnce('# Before').mockResolvedValueOnce('# Stale read')

    render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-README.md')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-README.md'))
    await waitFor(() => expect(screen.getByTestId('rich-editor')).toHaveTextContent('# Before'))

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.refresh' }))

    await waitFor(() => expect(mocks.listDirectory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.select_file'))
    expect(screen.queryByTestId('rich-editor')).not.toBeInTheDocument()
  })

  it('refreshes the selected PDF viewer without creating blob URLs', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['paper.pdf']).mockResolvedValueOnce(['paper.pdf'])

    const { container } = render(<ArtifactPane workspacePath="/tmp/workspace" />)

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.file_tree' }))
    await waitFor(() => expect(screen.getByTestId('tree-node-paper.pdf')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('tree-node-paper.pdf'))
    await waitFor(() =>
      expect(container.querySelector('iframe')?.getAttribute('src')).toBe('file:///tmp/workspace/paper.pdf#toolbar=0')
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.refresh' }))

    await waitFor(() => expect(mocks.listDirectory).toHaveBeenCalledTimes(2))
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.createObjectURL).not.toHaveBeenCalled()
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled()
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('file:///tmp/workspace/paper.pdf#toolbar=0')
    expect(container.querySelector('iframe')).not.toHaveAttribute('sandbox')
  })
})
