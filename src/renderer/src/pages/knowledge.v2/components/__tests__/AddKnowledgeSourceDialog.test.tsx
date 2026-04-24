import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddKnowledgeSourceDialog from '../AddKnowledgeSourceDialog'

let mockAcceptedFiles: File[] = []
const mockSubmitKnowledgeSources = vi.fn()
const mockUseKnowledgePage = vi.fn()
const mockUseAddKnowledgeSources = vi.fn()
const mockSelectFolder = vi.fn()
const mockGetPathForFile = vi.fn()
const mockGetFile = vi.fn()

const setMockAcceptedFiles = (files: File[]) => {
  mockAcceptedFiles = files
}

const createMockFile = (name: string, size: number) =>
  new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })

const createFileMetadata = ({ id, name, path }: { id: string; name: string; path: string }) => ({
  id,
  name,
  origin_name: name,
  path,
  size: 1024,
  ext: '.pdf',
  type: 'document' as const,
  created_at: '2026-04-23T10:00:00+08:00',
  count: 1
})

vi.mock('../../KnowledgePageProvider', () => ({
  useKnowledgePage: () => mockUseKnowledgePage()
}))

vi.mock('../../hooks/useAddKnowledgeSources', () => ({
  useAddKnowledgeSources: (...args: unknown[]) => mockUseAddKnowledgeSources(...args)
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  const DialogContext = React.createContext<{ onOpenChange: (open: boolean) => void; open: boolean }>({
    onOpenChange: () => undefined,
    open: false
  })
  const TabsContext = React.createContext<{ onValueChange: (value: string) => void; value: string }>({
    onValueChange: () => undefined,
    value: ''
  })

  return {
    Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <button {...props}>{children}</button>
    ),
    Dropzone: ({ children, onDrop, ...props }: { children: React.ReactNode; onDrop?: (files: File[]) => void }) => (
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

      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, {
          ...props,
          onClick: (event: React.MouseEvent<HTMLElement>) => {
            children.props.onClick?.(event)
            onOpenChange(false)
          }
        })
      }

      return <button {...props}>{children}</button>
    },
    DialogContent: ({
      children,
      ...props
    }: {
      children: React.ReactNode
      showCloseButton?: boolean
      [key: string]: unknown
    }) => {
      const { open } = React.use(DialogContext)
      const dialogProps = { ...props }
      delete dialogProps.showCloseButton

      return open ? (
        <div role="dialog" {...dialogProps}>
          {children}
        </div>
      ) : null
    },
    DialogTitle: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <h1 {...props}>{children}</h1>
    ),
    Tabs: ({
      children,
      value,
      onValueChange
    }: {
      children: React.ReactNode
      value: string
      onValueChange: (value: string) => void
    }) => <TabsContext value={{ value, onValueChange }}>{children}</TabsContext>,
    TabsContent: ({
      children,
      value,
      ...props
    }: {
      children: React.ReactNode
      value: string
      [key: string]: unknown
    }) => {
      const context = React.use(TabsContext)
      return context.value === value ? <div {...props}>{children}</div> : null
    },
    TabsList: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div role="tablist" {...props}>
        {children}
      </div>
    ),
    TabsTrigger: ({
      children,
      value,
      ...props
    }: {
      children: React.ReactNode
      value: string
      [key: string]: unknown
    }) => {
      const context = React.use(TabsContext)

      return (
        <button
          role="tab"
          aria-selected={context.value === value}
          onClick={() => context.onValueChange(value)}
          {...props}>
          {children}
        </button>
      )
    }
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      const translations = {
        'common.add': '添加',
        'common.cancel': '取消',
        'common.close': '关闭',
        'common.delete': '删除',
        'knowledge_v2.data_source.add_dialog.directory.description': '将递归导入文件夹中的支持文件',
        'knowledge_v2.data_source.add_dialog.directory.title': '点击选择文件夹',
        'knowledge_v2.data_source.add_dialog.footer.selected_directories': `已选 ${options?.count ?? 0} 个目录`,
        'knowledge_v2.data_source.add_dialog.footer.selected_files': `已选 ${options?.count ?? 0} 个文件`,
        'knowledge_v2.data_source.add_dialog.note.description': '选择已有笔记作为知识库数据源',
        'knowledge_v2.data_source.add_dialog.note.empty_description':
          '真实笔记列表接入后，将在这里展示可多选的笔记。当前可先使用文件、目录、网址或站点地图。',
        'knowledge_v2.data_source.add_dialog.note.empty_title': '暂未接入笔记数据源',
        'knowledge_v2.data_source.add_dialog.placeholder.supported_formats': '支持 PDF, DOCX, MD, XLSX, TXT, CSV',
        'knowledge_v2.data_source.add_dialog.placeholder.title': '点击选择文件或拖拽到此处',
        'knowledge_v2.data_source.add_dialog.sitemap.description': '输入 Sitemap 地址：',
        'knowledge_v2.data_source.add_dialog.sitemap.help': '将读取 Sitemap 中包含的页面并建立索引',
        'knowledge_v2.data_source.add_dialog.sitemap.placeholder': 'https://docs.cherry-ai.com/sitemap-pages.xml',
        'knowledge_v2.data_source.add_dialog.sources.directory': '目录',
        'knowledge_v2.data_source.add_dialog.sources.file': '文件',
        'knowledge_v2.data_source.add_dialog.sources.note': '笔记',
        'knowledge_v2.data_source.add_dialog.sources.sitemap': '网站',
        'knowledge_v2.data_source.add_dialog.sources.url': '网址',
        'knowledge_v2.data_source.add_dialog.submit.error': '添加数据源失败',
        'knowledge_v2.data_source.add_dialog.submit.success': '数据源已添加到知识库',
        'knowledge_v2.data_source.add_dialog.title': '添加数据源',
        'knowledge_v2.data_source.add_dialog.url.description': '输入网页链接：',
        'knowledge_v2.data_source.add_dialog.url.help': '将自动抓取页面文本并分块索引',
        'knowledge_v2.data_source.add_dialog.url.placeholder': 'https://example.com/article'
      } satisfies Record<string, string>

      return translations[key] ?? options?.defaultValue ?? key
    }
  })
}))

describe('AddKnowledgeSourceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMockAcceptedFiles([])
    mockUseKnowledgePage.mockReturnValue({ selectedBaseId: 'base-1' })
    mockUseAddKnowledgeSources.mockReturnValue({
      submit: mockSubmitKnowledgeSources,
      isSubmitting: false,
      error: undefined
    })
    mockGetPathForFile.mockImplementation((file: File) => `/external/${file.name}`)
    ;(window as any).api = {
      file: {
        get: mockGetFile,
        getPathForFile: mockGetPathForFile,
        selectFolder: mockSelectFolder
      }
    }
    ;(window as any).toast = { success: vi.fn(), error: vi.fn() }
  })

  const renderControlledDialog = (onOpenChange = vi.fn()) => {
    const DialogHarness = () => {
      const [open, setOpen] = useState(true)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            重新打开
          </button>
          <AddKnowledgeSourceDialog
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
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '添加数据源' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '网址' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '网站' })).toBeInTheDocument()
    expect(screen.getByText('点击选择文件或拖拽到此处')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('renders selected files and removes a file', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024), createMockFile('beta.md', 2048)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.getByText('beta.md')).toBeInTheDocument()
    expect(screen.getByText('已选 2 个文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])

    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('beta.md')).toBeInTheDocument()
    expect(screen.getByText('已选 1 个文件')).toBeInTheDocument()
  })

  it('keeps note disabled', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '笔记' }))

    expect(screen.getByText('暂未接入笔记数据源')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('selects directories through folder picker, deduplicates paths, and removes selections', async () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))
    expect(screen.getByText('点击选择文件夹')).toBeInTheDocument()
    expect(screen.getByText('将递归导入文件夹中的支持文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()

    mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))

    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument()
    })
    expect(screen.getByText('/Users/me/docs')).toBeInTheDocument()
    expect(screen.getByText('已选 1 个目录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()

    mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))
    await waitFor(() => {
      expect(mockSelectFolder).toHaveBeenCalledTimes(2)
    })
    expect(screen.getAllByText('docs')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByText('docs')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('keeps existing directories when folder picker is cancelled', async () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))
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

  it('enables url and sitemap submit only after input', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '网址' }))
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('https://example.com/article'), {
      target: { value: 'https://example.com/article' }
    })
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()

    fireEvent.click(screen.getByRole('tab', { name: '网站' }))
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('https://docs.cherry-ai.com/sitemap-pages.xml'), {
      target: { value: 'https://docs.cherry-ai.com/sitemap-pages.xml' }
    })
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
  })

  it('submits file source through generic hook with real file paths', async () => {
    const onOpenChange = vi.fn()
    const fileMetadata = createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' })
    mockGetFile.mockResolvedValueOnce(fileMetadata)
    mockSubmitKnowledgeSources.mockResolvedValueOnce(undefined)
    renderControlledDialog(onOpenChange)

    const selectedFile = createMockFile('alpha.pdf', 1024)
    setMockAcceptedFiles([selectedFile])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(mockSubmitKnowledgeSources).toHaveBeenCalledWith([{ type: 'file', data: { file: fileMetadata } }])
    })
    expect(mockGetPathForFile).toHaveBeenCalledWith(selectedFile)
    expect(mockGetFile).toHaveBeenCalledWith('/external/alpha.pdf')
    expect(window.toast.success).not.toHaveBeenCalled()
    expect(window.toast.error).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('submits directory, url, and sitemap source bodies through generic hook', async () => {
    mockSubmitKnowledgeSources.mockResolvedValue(undefined)
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))
    mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => {
      expect(mockSubmitKnowledgeSources).toHaveBeenLastCalledWith([
        { type: 'directory', data: { name: 'docs', path: '/Users/me/docs' } }
      ])
    })

    fireEvent.click(screen.getByRole('tab', { name: '网址' }))
    fireEvent.change(screen.getByPlaceholderText('https://example.com/article'), {
      target: { value: ' https://example.com/article ' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => {
      expect(mockSubmitKnowledgeSources).toHaveBeenLastCalledWith([
        { type: 'url', data: { url: 'https://example.com/article', name: 'https://example.com/article' } }
      ])
    })

    fireEvent.click(screen.getByRole('tab', { name: '网站' }))
    fireEvent.change(screen.getByPlaceholderText('https://docs.cherry-ai.com/sitemap-pages.xml'), {
      target: { value: ' https://docs.cherry-ai.com/sitemap-pages.xml ' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => {
      expect(mockSubmitKnowledgeSources).toHaveBeenLastCalledWith([
        {
          type: 'sitemap',
          data: {
            url: 'https://docs.cherry-ai.com/sitemap-pages.xml',
            name: 'https://docs.cherry-ai.com/sitemap-pages.xml'
          }
        }
      ])
    })
  })

  it('shows inline error and keeps selected files when create submit fails', async () => {
    const onOpenChange = vi.fn()
    mockGetFile.mockResolvedValueOnce(
      createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' })
    )
    mockSubmitKnowledgeSources.mockRejectedValueOnce(new Error('create failed'))
    renderControlledDialog(onOpenChange)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))

    await waitFor(() => {
      expect(mockSubmitKnowledgeSources).toHaveBeenCalledTimes(1)
    })

    expect(window.toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('添加数据源失败: create failed')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
  })

  it('closes without toast when runtime fails after creating items', async () => {
    const onOpenChange = vi.fn()
    const fileMetadata = createFileMetadata({ id: 'external-1', name: 'alpha.pdf', path: '/external/alpha.pdf' })
    mockGetFile.mockResolvedValueOnce(fileMetadata)
    mockSubmitKnowledgeSources.mockResolvedValueOnce({ itemIds: ['item-1'] })
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
    const { rerender } = render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))
    mockSelectFolder.mockResolvedValueOnce('/Users/me/docs')
    fireEvent.click(screen.getByTestId('knowledge-source-directory-select'))
    await screen.findByText('docs')

    fireEvent.click(screen.getByRole('tab', { name: '网址' }))
    fireEvent.change(screen.getByPlaceholderText('https://example.com/article'), {
      target: { value: 'https://example.com/article' }
    })

    rerender(<AddKnowledgeSourceDialog open={false} onOpenChange={vi.fn()} />)
    rerender(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))
    expect(screen.queryByText('docs')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '网址' }))
    expect(screen.getByPlaceholderText('https://example.com/article')).toHaveValue('')
  })
})
