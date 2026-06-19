import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddKnowledgeItemDialog from '../AddKnowledgeItemDialog'

const mockSubmitKnowledgeItems = vi.fn()
const mockUseKnowledgePage = vi.fn()
const mockUseAddKnowledgeItems = vi.fn()
const mockFileSelect = vi.fn()
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

// Native picker returns FileMetadata; only `path` + `origin_name`/`name` are read downstream.
const createSelectedFile = (name: string, path = `/picked/${name}`) => ({ name, origin_name: name, path }) as never

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
    DialogDescription: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <p {...props}>{children}</p>
    )
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
      'knowledge.data_source.add_dialog.conflict_dialog.title': '存在同名数据源',
      'knowledge.data_source.add_dialog.conflict_dialog.description': `有 ${options?.count ?? 0} 个数据源与知识库中已存在的项目同名，请选择处理方式。`,
      'knowledge.data_source.add_dialog.conflict_dialog.keep_all': '全部保留',
      'knowledge.data_source.add_dialog.conflict_dialog.replace': '替换',
      'knowledge.data_source.add_dialog.footer.selected_notes': `已选 ${options?.count ?? 0} 个笔记`,
      'knowledge.data_source.add_dialog.note.description': '选择已有笔记作为知识库数据源',
      'knowledge.data_source.add_dialog.note.empty_description': '请先在「笔记」功能中创建笔记，再回到这里选择。',
      'knowledge.data_source.add_dialog.note.empty_title': '未找到笔记',
      'knowledge.data_source.add_dialog.note.loading': '正在加载笔记…',
      'notes.tree_load_failed': '加载笔记目录失败',
      'knowledge.data_source.add_dialog.sources.directory': '目录',
      'knowledge.data_source.add_dialog.sources.file': '文件',
      'knowledge.data_source.add_dialog.sources.note': '笔记',
      'knowledge.data_source.add_dialog.sources.url': '链接',
      'knowledge.data_source.add_dialog.submit.error': '添加数据源失败',
      'knowledge.data_source.add_dialog.title': '添加数据源',
      'knowledge.data_source.add_dialog.unsupported_files_skipped': `已跳过 ${options?.count ?? 0} 个不支持的文件`,
      'knowledge.data_source.add_dialog.url.description': '输入网页链接：',
      'knowledge.data_source.add_dialog.url.help': '将自动抓取页面文本并分块索引',
      'knowledge.data_source.add_dialog.url.placeholder': 'https://example.com'
    } satisfies Record<string, string>

    return translations[key] ?? options?.defaultValue ?? key
  }

  return { useTranslation: () => ({ t }) }
})

describe('AddKnowledgeItemDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1', pendingAddSource: 'file' })
    mockUseAddKnowledgeItems.mockReturnValue({
      submit: mockSubmitKnowledgeItems,
      isSubmitting: false,
      error: undefined
    })
    mockSubmitKnowledgeItems.mockResolvedValue({ status: 'added' })
    // Default: picker cancelled, so a render that does not arrange a selection just closes.
    mockFileSelect.mockResolvedValue(null)
    mockSelectFolder.mockResolvedValue(null)
    mockGetPathForFile.mockImplementation((file: File) => `/external/${file.name}`)
    mockUseDirectoryTree.mockReturnValue({ root: {}, isLoading: false, error: null })
    mockProjectNotesTree.mockReturnValue([])
    ;(window as any).api = {
      file: {
        select: mockFileSelect,
        selectFolder: mockSelectFolder,
        getPathForFile: mockGetPathForFile,
        readExternal: mockReadExternal
      }
    }
    ;(window as any).toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })

  const setPendingAddSource = (pendingAddSource: 'file' | 'note' | 'directory' | 'url') => {
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1', pendingAddSource })
  }

  const setPendingAddFiles = (pendingAddFiles: File[]) => {
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1', pendingAddSource: 'file', pendingAddFiles })
  }

  describe('file source (native picker, no panel)', () => {
    it('opens the OS file picker on mount instead of rendering a panel', async () => {
      mockFileSelect.mockResolvedValueOnce([createSelectedFile('alpha.pdf')])
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(mockFileSelect).toHaveBeenCalledWith(
          expect.objectContaining({ properties: ['openFile', 'multiSelections'] })
        )
      })
      // No "添加数据源" panel for the file source.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: '添加数据源' })).not.toBeInTheDocument()
    })

    it('submits picked files via detect and closes when added', async () => {
      mockFileSelect.mockResolvedValueOnce([createSelectedFile('alpha.pdf', '/docs/alpha.pdf')])
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenCalledWith(
          [{ type: 'file', data: { source: '/docs/alpha.pdf', path: '/docs/alpha.pdf' } }],
          'detect'
        )
      })
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
      expect(window.toast.error).not.toHaveBeenCalled()
    })

    it('closes without submitting when the picker is cancelled', async () => {
      mockFileSelect.mockResolvedValueOnce(null)
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
      expect(mockSubmitKnowledgeItems).not.toHaveBeenCalled()
    })

    it('drops unsupported picks and warns about the skipped count', async () => {
      mockFileSelect.mockResolvedValueOnce([createSelectedFile('alpha.pdf'), createSelectedFile('photo.png')])
      render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenCalledWith(
          [{ type: 'file', data: { source: '/picked/alpha.pdf', path: '/picked/alpha.pdf' } }],
          'detect'
        )
      })
      expect(window.toast.warning).toHaveBeenCalledWith('已跳过 1 个不支持的文件')
    })

    it('submits page-level pending files without opening the picker', async () => {
      setPendingAddFiles([createMockFile('external.pdf', 1024), createMockFile('external.exe', 1024)])
      render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenCalledWith(
          [{ type: 'file', data: { source: '/external/external.pdf', path: '/external/external.pdf' } }],
          'detect'
        )
      })
      expect(mockFileSelect).not.toHaveBeenCalled()
      expect(window.toast.warning).toHaveBeenCalledWith('已跳过 1 个不支持的文件')
    })

    it('toasts and closes when the submit rejects (no panel to fall back to)', async () => {
      mockFileSelect.mockResolvedValueOnce([createSelectedFile('alpha.pdf')])
      mockSubmitKnowledgeItems.mockRejectedValueOnce(new Error('create failed'))
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(window.toast.error).toHaveBeenCalledWith('添加数据源失败: create failed')
      })
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })
  })

  describe('directory source (native picker, no panel)', () => {
    it('opens the OS folder picker and submits the chosen folder via detect', async () => {
      setPendingAddSource('directory')
      mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenCalledWith(
          [{ type: 'directory', data: { source: '/Users/me/docs' } }],
          'detect'
        )
      })
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('closes without submitting when the folder picker is cancelled', async () => {
      setPendingAddSource('directory')
      mockSelectFolder.mockResolvedValueOnce(null)
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
      expect(mockSubmitKnowledgeItems).not.toHaveBeenCalled()
    })
  })

  describe('note source (panel)', () => {
    it('renders the note picker and reflects selection in the footer', () => {
      setPendingAddSource('note')
      mockProjectNotesTree.mockReturnValue([
        createNoteNode('Meeting notes', '/notes/Meeting notes.md'),
        createNoteNode('Ideas', '/notes/Ideas.md')
      ])
      render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

      expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'lg')
      expect(screen.getByText('Meeting notes')).toBeInTheDocument()
      expect(screen.getByText('Ideas')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()

      fireEvent.click(screen.getAllByRole('checkbox')[0])

      expect(screen.getByText('已选 1 个笔记')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
    })

    it('submits note source body through the generic hook', async () => {
      setPendingAddSource('note')
      mockProjectNotesTree.mockReturnValue([createNoteNode('Meeting notes', '/notes/Meeting notes.md')])
      mockReadExternal.mockResolvedValueOnce('# Meeting\n\nbody')
      render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.click(screen.getByRole('button', { name: '添加' }))

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenLastCalledWith(
          [{ type: 'note', data: { source: 'Meeting notes', content: '# Meeting\n\nbody' } }],
          'detect'
        )
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
  })

  describe('url source (panel)', () => {
    it('enables url submit only after input', () => {
      setPendingAddSource('url')
      render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

      expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
      fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
        target: { value: 'https://example.com' }
      })
      expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
    })

    it('submits url source body through the generic hook, trimming the input', async () => {
      setPendingAddSource('url')
      render(<AddKnowledgeItemDialog open onOpenChange={vi.fn()} />)

      fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
        target: { value: ' https://example.com ' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenLastCalledWith(
          [{ type: 'url', data: { source: 'https://example.com', url: 'https://example.com' } }],
          'detect'
        )
      })
    })

    it('shows an inline error and keeps the panel open when the url submit fails', async () => {
      setPendingAddSource('url')
      mockSubmitKnowledgeItems.mockRejectedValueOnce(new Error('create failed'))
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
        target: { value: 'https://example.com' }
      })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('添加数据源失败: create failed')
      expect(window.toast.error).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })
  })

  describe('same-name conflict resolution', () => {
    it('surfaces the conflict dialog after a file pick and resolves with keep all', async () => {
      mockFileSelect.mockResolvedValueOnce([createSelectedFile('alpha.pdf')])
      mockSubmitKnowledgeItems
        .mockResolvedValueOnce({ status: 'conflicts', conflicts: [{ type: 'file', title: 'alpha.pdf' }] })
        .mockResolvedValueOnce({ status: 'added' })
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      const keepAll = await screen.findByRole('button', { name: '全部保留' })
      expect(screen.getByText('存在同名数据源')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '替换' })).toBeInTheDocument()
      // The first pass is always a detect; nothing is added yet.
      expect(mockSubmitKnowledgeItems).toHaveBeenNthCalledWith(1, expect.any(Array), 'detect')
      expect(onOpenChange).not.toHaveBeenCalledWith(false)

      fireEvent.click(keepAll)

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenNthCalledWith(2, expect.any(Array), 'rename')
      })
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    it('resolves the conflict dialog with replace', async () => {
      mockFileSelect.mockResolvedValueOnce([createSelectedFile('alpha.pdf')])
      mockSubmitKnowledgeItems
        .mockResolvedValueOnce({ status: 'conflicts', conflicts: [{ type: 'file', title: 'alpha.pdf' }] })
        .mockResolvedValueOnce({ status: 'added' })
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      const replace = await screen.findByRole('button', { name: '替换' })
      fireEvent.click(replace)

      await waitFor(() => {
        expect(mockSubmitKnowledgeItems).toHaveBeenNthCalledWith(2, expect.any(Array), 'replace')
      })
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    it('cancelling the conflict on a direct-pick source closes the whole flow', async () => {
      mockFileSelect.mockResolvedValueOnce([createSelectedFile('alpha.pdf')])
      mockSubmitKnowledgeItems.mockResolvedValueOnce({
        status: 'conflicts',
        conflicts: [{ type: 'file', title: 'alpha.pdf' }]
      })
      const onOpenChange = vi.fn()
      render(<AddKnowledgeItemDialog open onOpenChange={onOpenChange} />)

      fireEvent.click(await screen.findByRole('button', { name: '取消' }))

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
      // Only the detect pass ran; nothing was added.
      expect(mockSubmitKnowledgeItems).toHaveBeenCalledTimes(1)
    })
  })
})
