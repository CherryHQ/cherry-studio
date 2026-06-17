import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddKnowledgeItemDialog from '../AddKnowledgeItemDialog'

let mockAcceptedFiles: File[] = []
const mockSubmitKnowledgeItems = vi.fn()
const mockUseKnowledgePage = vi.fn()
const mockUseAddKnowledgeItems = vi.fn()
const mockSelectFolder = vi.fn()
const mockGetPathForFile = vi.fn()
const mockReadExternal = vi.fn()
const mockUseDirectoryTree = vi.fn()
const mockProjectNotesTree = vi.fn()

const createNoteNode = (name: string, externalPath: string) => ({
  id: externalPath,
  name,
  type: 'file' as const,
  treePath: `/${name}`,
  externalPath,
  createdAt: '',
  updatedAt: ''
})

const setMockAcceptedFiles = (files: File[]) => {
  mockAcceptedFiles = files
}

const createMockFile = (name: string, size: number) =>
  new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })

vi.mock('../../KnowledgePageProvider', () => ({
  useKnowledgePage: () => mockUseKnowledgePage()
}))

vi.mock('@renderer/hooks/useKnowledgeItems', () => ({
  useAddKnowledgeItems: (...args: unknown[]) => mockUseAddKnowledgeItems(...args)
}))

// The note picker's real data layer (useNotesSettings → NotesService → @renderer/utils)
// pulls in the i18n bootstrap at module load, which throws under the react-i18next mock.
// Stub the three note modules so the dialog graph stays bootstrap-free and the note list
// is fully controllable from each test.
vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ notesPath: '/notes' })
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: () => mockUseDirectoryTree()
}))

vi.mock('@renderer/services/NotesService', () => ({
  projectNotesTree: () => mockProjectNotesTree()
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  const DialogContext = React.createContext<{ onOpenChange: (open: boolean) => void; open: boolean }>({
    onOpenChange: () => undefined,
    open: false
  })

  return {
    Button: ({
      children,
      type = 'button',
      ...props
    }: {
      children: React.ReactNode
      loading?: boolean
      type?: 'button' | 'submit' | 'reset'
      [key: string]: unknown
    }) => (
      <button type={type} {...props}>
        {children}
      </button>
    ),
    Dropzone: ({
      children,
      onDrop,
      ...props
    }: {
      children: React.ReactNode
      maxFiles?: number
      onDrop?: (files: File[]) => void
    }) => (
      <div data-testid="file-dropzone" {...props}>
        <button type="button" data-testid="mock-file-dropzone-trigger" onClick={() => onDrop?.(mockAcceptedFiles)}>
          触发选择
        </button>
        {children}
      </div>
    ),
    DropzoneEmptyState: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Checkbox: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
      [key: string]: unknown
    }) => (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
        {...props}
      />
    ),
    Dialog: ({
      children,
      open,
      onOpenChange
    }: {
      children: React.ReactNode
      open: boolean
      onOpenChange: (open: boolean) => void
    }) => <DialogContext value={{ open, onOpenChange }}>{children}</DialogContext>,
    DialogClose: ({
      asChild,
      children,
      ...props
    }: {
      asChild?: boolean
      children: React.ReactElement<{ onClick?: (event: React.MouseEvent<HTMLElement>) => void }>
      [key: string]: unknown
    }) => {
      const { onOpenChange } = React.use(DialogContext)

      if (asChild) {
        return (
          <span role="presentation" {...props} onClick={() => onOpenChange(false)}>
            {children}
          </span>
        )
      }

      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    DialogContent: ({
      children,
      size,
      ...props
    }: {
      children: React.ReactNode
      showCloseButton?: boolean
      size?: string
      [key: string]: unknown
    }) => {
      const { open } = React.use(DialogContext)
      const dialogProps = { ...props }
      delete dialogProps.showCloseButton

      return open ? (
        <div role="dialog" data-size={size} {...dialogProps}>
          {children}
        </div>
      ) : null
    },
    DialogFooter: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    DialogHeader: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    DialogTitle: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <h1 {...props}>{children}</h1>
    ),
    Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PopoverContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

vi.mock('react-i18next', () => {
  // A single stable `t` reference (like the real react-i18next), so effects that depend
  // on `t` are not re-triggered every render.
  const t = (key: string, options?: { count?: number; defaultValue?: string; file_types?: string }) => {
    const translations = {
      'common.add': '添加',
      'common.cancel': '取消',
      'common.close': '关闭',
      'common.delete': '删除',
      'knowledge.drag_file': '拖拽文件到这里',
      'knowledge.data_source.add_dialog.directory.description': '将递归导入文件夹中的支持文件',
      'knowledge.data_source.add_dialog.directory.title': '点击选择文件夹',
      'knowledge.data_source.add_dialog.footer.selected_directories': `已选 ${options?.count ?? 0} 个目录`,
      'knowledge.data_source.add_dialog.footer.selected_files': `已选 ${options?.count ?? 0} 个文件`,
      'knowledge.data_source.add_dialog.footer.selected_notes': `已选 ${options?.count ?? 0} 个笔记`,
      'knowledge.data_source.add_dialog.note.description': '选择已有笔记作为知识库数据源',
      'knowledge.data_source.add_dialog.note.empty_description': '请先在「笔记」功能中创建笔记，再回到这里选择。',
      'knowledge.data_source.add_dialog.note.empty_title': '未找到笔记',
      'knowledge.data_source.add_dialog.note.loading': '正在加载笔记…',
      'notes.tree_load_failed': '加载笔记目录失败',
      'knowledge.data_source.add_dialog.placeholder.supported_formats': '支持 PDF, DOCX, MD, XLSX, TXT, CSV',
      'knowledge.data_source.add_dialog.placeholder.title': '点击选择文件或拖拽到此处',
      'knowledge.data_source.add_dialog.sources.directory': '目录',
      'knowledge.data_source.add_dialog.sources.file': '文件',
      'knowledge.data_source.add_dialog.sources.note': '笔记',
      'knowledge.data_source.add_dialog.sources.url': '链接',
      'knowledge.data_source.add_dialog.submit.error': '添加数据源失败',
      'knowledge.data_source.add_dialog.submit.success': '数据源已添加到知识库',
      'knowledge.data_source.add_dialog.title': '添加数据源',
      'knowledge.data_source.add_dialog.unsupported_files_skipped': `已跳过 ${options?.count ?? 0} 个不支持的文件`,
      'knowledge.data_source.add_dialog.url.description': '输入网页链接：',
      'knowledge.data_source.add_dialog.url.help': '将自动抓取页面文本并分块索引',
      'knowledge.data_source.add_dialog.url.placeholder': 'https://example.com',
      'knowledge.file_hint': `支持 ${options?.file_types} 格式`
    } satisfies Record<string, string>

    return translations[key] ?? options?.defaultValue ?? key
  }

  return { useTranslation: () => ({ t }) }
})

describe('AddKnowledgeItemDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMockAcceptedFiles([])
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1' })
    mockUseAddKnowledgeItems.mockReturnValue({
      submit: mockSubmitKnowledgeItems,
      isSubmitting: false,
      error: undefined
    })
    mockGetPathForFile.mockImplementation((file: File) => `/external/${file.name}`)
    mockUseDirectoryTree.mockReturnValue({ root: {}, isLoading: false, error: null })
    mockProjectNotesTree.mockReturnValue([])
    ;(window as any).api = {
      file: {
        getPathForFile: mockGetPathForFile,
        selectFolder: mockSelectFolder,
        readExternal: mockReadExternal
      }
    }
    ;(window as any).toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })

  const setPendingAddSource = (pendingAddSource: 'file' | 'note' | 'directory' | 'url') => {
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1', pendingAddSource })
  }

  const setPendingAddFiles = (pendingAddFiles: File[]) => {
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1', pendingAddFiles })
  }

  const renderControlledDialog = (onOpenChange = vi.fn()) => {
    const DialogHarness = () => {
      const [open, setOpen] = useState(true)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            重新打开
          </button>
          <AddKnowledgeItemDialog
            open={open}
            onOpenChange={(nextOpen) => {
              setOpen(nextOpen)
              onOpenChange(nextOpen)
            }}
          />
        </>
      )
    }

    return render(<DialogHarness />)
  }

  it('renders default file content and disabled add action', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'lg')
    expect(screen.getByRole('heading', { name: '添加数据源' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.getByText('拖拽文件到这里')).toBeInTheDocument()
    expect(screen.getByText('支持 PDF, DOCX, DOC, PPTX, XLSX, XLS, MD, TXT, CSV, HTML, EPUB 格式')).toBeInTheDocument()
    expect(screen.getByTestId('file-dropzone').querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('renders selected files and removes a file', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024), createMockFile('beta.md', 2048)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.getByText('beta.md')).toBeInTheDocument()
    expect(screen.getByText('已选 2 个文件')).toBeInTheDocument()
    expect(screen.getByText('拖拽文件到这里')).toBeInTheDocument()
    expect(
      screen.getByTestId('knowledge-source-file-list').compareDocumentPosition(screen.getByTestId('file-dropzone')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])

    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('beta.md')).toBeInTheDocument()
    expect(screen.getByText('已选 1 个文件')).toBeInTheDocument()
  })

  it('keeps only supported files selected when files are dropped and warns about the skipped one', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([
      createMockFile('alpha.pdf', 1024),
      createMockFile('notes.draftsExport', 1024),
      createMockFile('beta.exe', 2048)
    ])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.getByText('notes.draftsExport')).toBeInTheDocument()
    expect(screen.queryByText('beta.exe')).not.toBeInTheDocument()
    expect(screen.getByText('已选 2 个文件')).toBeInTheDocument()
    expect(window.toast.warning).toHaveBeenCalledWith('已跳过 1 个不支持的文件')
  })

  it('appends supported files and warns when a drop mixes in unsupported types', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    // The dropzone has no `accept` filter, so a mixed drop (alpha.pdf + photo.png) delivers every
    // file here; the supported one must still be added and the skipped one counted.
    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024), createMockFile('photo.png', 2048)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument()
    expect(screen.getByText('已选 1 个文件')).toBeInTheDocument()
    expect(window.toast.warning).toHaveBeenCalledWith('已跳过 1 个不支持的文件')
  })

  it('does not warn when every dropped file is supported', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024), createMockFile('beta.md', 2048)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(window.toast.warning).not.toHaveBeenCalled()
  })

  it('appends newly dropped files instead of overwriting the existing selection', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getByText('已选 1 个文件')).toBeInTheDocument()

    // A second drop of a different file must keep the previously selected file
    // (regression: it used to overwrite the whole selection).
    setMockAcceptedFiles([createMockFile('beta.md', 2048)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.getByText('beta.md')).toBeInTheDocument()
    expect(screen.getByText('已选 2 个文件')).toBeInTheDocument()
  })

  it('skips files already present in the selection when dropped again without warning about them', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    const duplicate = createMockFile('alpha.pdf', 1024)
    setMockAcceptedFiles([duplicate])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    setMockAcceptedFiles([duplicate, createMockFile('beta.md', 2048)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getByText('已选 2 个文件')).toBeInTheDocument()
    // A re-dropped, already-selected file is deduplicated — not "unsupported" — so it
    // must never be counted in the skipped-files warning.
    expect(window.toast.warning).not.toHaveBeenCalled()
  })

  it('keeps two same-named files from different folders, deduping by path rather than name', () => {
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    // Identical name and size — only the on-disk path differs. Keying dedup off
    // name+size+lastModified used to silently drop the second file; path keying keeps both,
    // matching the backend, which auto-renames same-named files on disk.
    const fromFolderA = createMockFile('report.pdf', 1024)
    const fromFolderB = createMockFile('report.pdf', 1024)
    mockGetPathForFile.mockImplementation((file: File) =>
      file === fromFolderA ? '/folderA/report.pdf' : '/folderB/report.pdf'
    )
    setMockAcceptedFiles([fromFolderA, fromFolderB])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getAllByText('report.pdf')).toHaveLength(2)
    expect(screen.getByText('已选 2 个文件')).toBeInTheDocument()
    expect(window.toast.warning).not.toHaveBeenCalled()
  })

  it('renders files passed from the external footer dropzone and warns about skipped ones', () => {
    setPendingAddFiles([createMockFile('external.pdf', 1024), createMockFile('external.exe', 1024)])

    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('external.pdf')).toBeInTheDocument()
    expect(screen.queryByText('external.exe')).not.toBeInTheDocument()
    expect(screen.getByText('已选 1 个文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
    expect(window.toast.warning).toHaveBeenCalledWith('已跳过 1 个不支持的文件')
  })

  it('renders the note picker and reflects selection in the footer', () => {
    setPendingAddSource('note')
    mockProjectNotesTree.mockReturnValue([
      createNoteNode('Meeting notes', '/notes/Meeting notes.md'),
      createNoteNode('Ideas', '/notes/Ideas.md')
    ])
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('Meeting notes')).toBeInTheDocument()
    expect(screen.getByText('Ideas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()

    fireEvent.click(screen.getAllByRole('checkbox')[0])

    expect(screen.getByText('已选 1 个笔记')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
  })

  it('submits note source body through generic hook', async () => {
    setPendingAddSource('note')
    mockProjectNotesTree.mockReturnValue([createNoteNode('Meeting notes', '/notes/Meeting notes.md')])
    mockReadExternal.mockResolvedValueOnce('# Meeting\n\nbody')
    mockSubmitKnowledgeItems.mockResolvedValue(undefined)
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenLastCalledWith([
        {
          type: 'note',
          data: {
            source: 'Meeting notes',
            content: '# Meeting\n\nbody'
          }
        }
      ])
    })
    expect(mockReadExternal).toHaveBeenCalledWith('/notes/Meeting notes.md')
  })

  it('surfaces a note tree load error instead of the empty state', () => {
    setPendingAddSource('note')
    mockUseDirectoryTree.mockReturnValue({ root: null, isLoading: false, error: new Error('read failed') })
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('加载笔记目录失败')).toBeInTheDocument()
    expect(screen.queryByText('未找到笔记')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('toggles multiple notes and deselects keyed by note path', () => {
    setPendingAddSource('note')
    mockProjectNotesTree.mockReturnValue([
      createNoteNode('Meeting notes', '/notes/Meeting notes.md'),
      createNoteNode('Ideas', '/notes/Ideas.md')
    ])
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('已选 2 个笔记')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByText('已选 1 个笔记')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
  })

  it('shows an inline error naming the note when its content cannot be read', async () => {
    setPendingAddSource('note')
    mockProjectNotesTree.mockReturnValue([createNoteNode('Meeting notes', '/notes/Meeting notes.md')])
    mockReadExternal.mockRejectedValueOnce(new Error('ENOENT'))
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('添加数据源失败: Meeting notes: ENOENT')
    expect(mockSubmitKnowledgeItems).not.toHaveBeenCalled()
  })

  it('selects directories through folder picker, deduplicates paths, and removes selections', async () => {
    setPendingAddSource('directory')
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('点击选择文件夹')).toBeInTheDocument()
    expect(screen.getByText('将递归导入文件夹中的支持文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()

    mockSelectFolder.mockResolvedValueOnce('/Users/me/projects/downloads')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))

    await waitFor(() => {
      expect(screen.getByText('downloads')).toBeInTheDocument()
    })
    const directoryName = screen.getByText('downloads')
    const directoryPath = screen.getByText('/Users/me/projects/downloads')
    const directoryItem = directoryName.closest('[role="listitem"]')

    expect(screen.getByText('/Users/me/projects/downloads')).toBeInTheDocument()
    expect(directoryItem).toHaveClass('min-w-0')
    expect(directoryItem).toHaveClass('max-w-full')
    expect(directoryItem).toHaveClass('overflow-hidden')
    expect(directoryItem).toHaveClass('grid')
    expect(directoryName).toHaveClass('min-w-0')
    expect(directoryName).toHaveClass('truncate')
    expect(directoryName).toHaveAttribute('title', 'downloads')
    expect(directoryPath).toHaveClass('min-w-0')
    expect(directoryPath).toHaveClass('max-w-60')
    expect(directoryPath).toHaveClass('truncate')
    expect(directoryPath).toHaveAttribute('title', '/Users/me/projects/downloads')
    expect(screen.getByTestId('knowledge-source-directory-list')).toHaveClass('min-h-0')
    expect(screen.getByTestId('knowledge-source-directory-list')).toHaveClass('flex-1')
    expect(screen.getByTestId('knowledge-source-directory-list')).toHaveClass('overflow-y-auto')
    expect(screen.getByText('已选 1 个目录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()

    mockSelectFolder.mockResolvedValueOnce('/Users/me/projects/downloads')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))
    await waitFor(() => {
      expect(mockSelectFolder).toHaveBeenCalledTimes(2)
    })
    expect(screen.getAllByText('downloads')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByText('downloads')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('keeps existing directories when folder picker is cancelled', async () => {
    setPendingAddSource('directory')
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))
    await screen.findByText('docs')

    mockSelectFolder.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))

    await waitFor(() => {
      expect(mockSelectFolder).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByText('docs')).toBeInTheDocument()
  })

  it('enables url submit only after input', () => {
    setPendingAddSource('url')
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)
    const urlInput = screen.getByPlaceholderText('https://example.com')

    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
    expect(urlInput.parentElement).toHaveClass('min-w-0')
    expect(urlInput.parentElement?.parentElement).toHaveClass('min-w-0')
    expect(urlInput).toHaveClass('w-full')
    expect(urlInput).toHaveClass('border-border-subtle')
    expect(urlInput).toHaveClass('focus-visible:ring-0')
    fireEvent.change(urlInput, {
      target: { value: 'https://example.com' }
    })
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
  })

  it('submits directory source body through generic hook', async () => {
    setPendingAddSource('directory')
    mockSubmitKnowledgeItems.mockResolvedValue(undefined)
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenLastCalledWith([
        {
          type: 'directory',
          data: {
            source: '/Users/me/docs',
            path: '/Users/me/docs'
          }
        }
      ])
    })
  })

  it('submits url source body through generic hook', async () => {
    setPendingAddSource('url')
    mockSubmitKnowledgeItems.mockResolvedValue(undefined)
    render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: ' https://example.com ' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenLastCalledWith([
        {
          type: 'url',
          data: {
            source: 'https://example.com',
            url: 'https://example.com'
          }
        }
      ])
    })
  })

  it('submits file source through generic hook with real file paths', async () => {
    const onOpenChange = vi.fn()
    mockSubmitKnowledgeItems.mockResolvedValueOnce(undefined)
    renderControlledDialog(onOpenChange)

    const selectedFile = createMockFile('alpha.pdf', 1024)
    setMockAcceptedFiles([selectedFile])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenCalledWith([
        {
          type: 'file',
          data: {
            source: '/external/alpha.pdf',
            path: '/external/alpha.pdf'
          }
        }
      ])
    })
    expect(mockGetPathForFile).toHaveBeenCalledWith(selectedFile)
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables submit while file path resolution is pending', async () => {
    const onOpenChange = vi.fn()
    let resolveSubmit: () => void = () => undefined
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve
    })
    mockSubmitKnowledgeItems.mockReturnValueOnce(submitPromise)
    renderControlledDialog(onOpenChange)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    // Drop-time dedup now resolves each file's path too; reset so the count below
    // measures only submit-time path resolution (proving the second click is debounced).
    mockGetPathForFile.mockClear()

    const addButton = screen.getByRole('button', { name: '添加' })
    fireEvent.click(addButton)
    fireEvent.click(addButton)

    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenCalledTimes(1)
    })
    expect(addButton).toBeDisabled()
    expect(mockGetPathForFile).toHaveBeenCalledTimes(1)

    resolveSubmit()

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows inline error and keeps selected files when create submit fails', async () => {
    const onOpenChange = vi.fn()
    mockSubmitKnowledgeItems.mockRejectedValueOnce(new Error('create failed'))
    renderControlledDialog(onOpenChange)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(mockSubmitKnowledgeItems).toHaveBeenCalledTimes(1)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('添加数据源失败: create failed')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
  })

  it('wraps long submit errors inside a bounded inline alert', async () => {
    const onOpenChange = vi.fn()
    const longErrorMessage = `Error invoking remote method 'knowledge:add-items': ${JSON.stringify({
      issues: [
        {
          code: 'invalid_union',
          keys: ['id', 'base_id', 'group_id', 'type', 'data', 'status', 'phase', 'error', 'created_at', 'updated_at'],
          path: ['/Users/eeee/Documents/very-long-directory-name/1.txt']
        }
      ]
    })}`
    mockSubmitKnowledgeItems.mockRejectedValueOnce(new Error(longErrorMessage))
    renderControlledDialog(onOpenChange)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    const alert = await screen.findByRole('alert')

    expect(alert).toHaveTextContent('添加数据源失败')
    expect(alert).toHaveTextContent('knowledge:add-items')
    expect(alert).toHaveAttribute('title', expect.stringContaining('knowledge:add-items'))
    expect(alert).toHaveClass('max-h-16')
    expect(alert).toHaveClass('w-full')
    expect(alert).toHaveClass('min-w-0')
    expect(alert).toHaveClass('overflow-y-auto')
    expect(alert).toHaveClass('wrap-break-word')
    expect(alert).toHaveClass('whitespace-pre-wrap')
    expect(alert.parentElement).toHaveClass('min-w-0')
    expect(alert.parentElement).toHaveClass('overflow-hidden')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes without toast when runtime fails after creating items', async () => {
    const onOpenChange = vi.fn()
    mockSubmitKnowledgeItems.mockResolvedValueOnce(undefined)
    renderControlledDialog(onOpenChange)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('resets local selections after closing and reopening', async () => {
    const { rerender } = render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    setPendingAddSource('directory')
    rerender(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)
    mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))
    await screen.findByText('docs')

    setPendingAddSource('url')
    rerender(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
      target: { value: 'https://example.com' }
    })

    rerender(<AddKnowledgeItemDialog open={false} onOpenChange={vi.fn()} />)
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1' })
    rerender(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()

    setPendingAddSource('directory')
    rerender(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)
    expect(screen.queryByText('docs')).not.toBeInTheDocument()

    setPendingAddSource('url')
    rerender(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('https://example.com')).toHaveValue('')
  })
})
