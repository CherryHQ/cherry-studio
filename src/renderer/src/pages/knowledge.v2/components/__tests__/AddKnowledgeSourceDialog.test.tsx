import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AddKnowledgeSourceDialog from '../AddKnowledgeSourceDialog'

let mockAcceptedFiles: File[] = []

const setMockAcceptedFiles = (files: File[]) => {
  mockAcceptedFiles = files
}

const createMockFile = (name: string, size: number, webkitRelativePath?: string) => {
  const file = new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })

  if (webkitRelativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: webkitRelativePath
    })
  }

  return file
}

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')

  const DialogContext = React.createContext<{
    onOpenChange: (open: boolean) => void
    open: boolean
  }>({
    onOpenChange: () => undefined,
    open: false
  })

  const TabsContext = React.createContext<{
    onValueChange: (value: string) => void
    value: string
  }>({
    onValueChange: () => undefined,
    value: ''
  })

  return {
    Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <button {...props}>{children}</button>
    ),
    Dropzone: ({
      children,
      onDrop,
      webkitdirectory,
      ...props
    }: {
      children: React.ReactNode
      onDrop?: (acceptedFiles: File[], fileRejections: unknown[], event: unknown) => void
      webkitdirectory?: boolean | string
      [key: string]: unknown
    }) => {
      const isDirectoryDropzone = webkitdirectory !== undefined

      return (
        <div data-testid={isDirectoryDropzone ? 'directory-dropzone' : 'file-dropzone'} {...props}>
          <button
            type="button"
            data-testid={isDirectoryDropzone ? 'mock-directory-dropzone-trigger' : 'mock-file-dropzone-trigger'}
            onClick={() => onDrop?.(mockAcceptedFiles, [], {})}>
            触发选择
          </button>
          {children}
        </div>
      )
    },
    DropzoneEmptyState: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    EmptyState: ({
      title,
      description,
      ...props
    }: {
      title?: React.ReactNode
      description?: React.ReactNode
      [key: string]: unknown
    }) => (
      <div {...props}>
        {title ? <div>{title}</div> : null}
        {description ? <div>{description}</div> : null}
      </div>
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
    t: (key: string, options?: { count?: number }) =>
      (
        ({
          'common.add': '添加',
          'common.cancel': '取消',
          'common.close': '关闭',
          'common.delete': '删除',
          'knowledge_v2.data_source.add_dialog.directory.description': '递归导入目录中的 PDF, DOCX, MD, XLSX, TXT, CSV',
          'knowledge_v2.data_source.add_dialog.directory.title': '点击选择目录或拖拽到此处',
          'knowledge_v2.data_source.add_dialog.footer.selected_directories': `已选 ${options?.count ?? 0} 个目录`,
          'knowledge_v2.data_source.add_dialog.footer.selected_files': `已选 ${options?.count ?? 0} 个文件`,
          'knowledge_v2.data_source.add_dialog.footer.selected_notes': `已选 ${options?.count ?? 0} 个笔记`,
          'knowledge_v2.data_source.add_dialog.note.description': '选择已有笔记作为知识库数据源',
          'knowledge_v2.data_source.add_dialog.note.empty_description':
            '真实笔记列表接入后，将在这里展示可多选的笔记。当前可先使用文件、目录、网址或网站。',
          'knowledge_v2.data_source.add_dialog.note.empty_title': '暂未接入笔记数据源',
          'knowledge_v2.data_source.add_dialog.title': '添加数据源',
          'knowledge_v2.data_source.add_dialog.sources.file': '文件',
          'knowledge_v2.data_source.add_dialog.sources.note': '笔记',
          'knowledge_v2.data_source.add_dialog.sources.directory': '目录',
          'knowledge_v2.data_source.add_dialog.sources.url': '网址',
          'knowledge_v2.data_source.add_dialog.sources.website': '网站',
          'knowledge_v2.data_source.add_dialog.placeholder.title': '点击选择文件或拖拽到此处',
          'knowledge_v2.data_source.add_dialog.placeholder.supported_formats': '支持 PDF, DOCX, MD, XLSX, TXT, CSV',
          'knowledge_v2.data_source.add_dialog.url.description': '输入网页链接：',
          'knowledge_v2.data_source.add_dialog.url.help': '将自动抓取页面文本并分块索引',
          'knowledge_v2.data_source.add_dialog.url.input_label': '网页地址',
          'knowledge_v2.data_source.add_dialog.url.placeholder': 'https://example.com/article',
          'knowledge_v2.data_source.add_dialog.url.title': '导入单个网页',
          'knowledge_v2.data_source.add_dialog.website.depth_label': '爬取深度',
          'knowledge_v2.data_source.add_dialog.website.description': '输入站点地址或 Sitemap：',
          'knowledge_v2.data_source.add_dialog.website.help': '深度 1 = 仅首页，2 = 首页链接的页面',
          'knowledge_v2.data_source.add_dialog.website.input_label': '站点地址 / Sitemap',
          'knowledge_v2.data_source.add_dialog.website.max_pages_label': '最大页面数',
          'knowledge_v2.data_source.add_dialog.website.placeholder': 'https://docs.cherry-ai.com/',
          'knowledge_v2.data_source.add_dialog.website.sitemap_example':
            'Sitemap 示例：https://docs.cherry-ai.com/sitemap-pages.xml',
          'knowledge_v2.data_source.add_dialog.website.settings_description': '设置默认爬取范围和页面数量上限',
          'knowledge_v2.data_source.add_dialog.website.settings_title': '爬虫设置',
          'knowledge_v2.data_source.add_dialog.website.title': '导入网站或 Sitemap',
          'knowledge_v2.meta.documents_count': `${options?.count ?? 0} 文档`
        }) as Record<string, string>
      )[key] ?? key
  })
}))

describe('AddKnowledgeSourceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMockAcceptedFiles([])
  })

  it('renders the confirmed title, close control, five source tabs, default file content, and disabled add action', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveClass('max-h-[70vh]')
    expect(dialog).not.toHaveClass('h-[240px]')
    expect(screen.getByRole('heading', { name: '添加数据源' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '网址' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '网站' })).toBeInTheDocument()
    expect(screen.getByText('点击选择文件或拖拽到此处')).toBeInTheDocument()
    expect(screen.getByText('支持 PDF, DOCX, MD, XLSX, TXT, CSV')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-source-file-list')).not.toBeInTheDocument()
    expect(screen.queryByText('已选 0 个文件')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('renders the selected file list below the dropzone and removes a file when delete is clicked', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024), createMockFile('beta.md', 2048)])

    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))

    const fileList = screen.getByTestId('knowledge-source-file-list')

    expect(fileList).toHaveClass('max-h-52')
    expect(fileList).toHaveClass('overflow-y-auto')
    expect(screen.getByText('alpha.pdf')).toBeInTheDocument()
    expect(screen.getByText('beta.md')).toBeInTheDocument()
    expect(screen.getByText('1 KB')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    expect(screen.getByText('已选 2 个文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])

    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('beta.md')).toBeInTheDocument()
    expect(screen.getByText('已选 1 个文件')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(1)
  })

  it('renders the note placeholder state and keeps add disabled before the real integration lands', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '笔记' }))

    expect(screen.getByRole('tab', { name: '笔记' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('暂未接入笔记数据源')).toBeInTheDocument()
    expect(
      screen.getByText('真实笔记列表接入后，将在这里展示可多选的笔记。当前可先使用文件、目录、网址或网站。')
    ).toBeInTheDocument()
    expect(screen.queryByText('已选 1 个笔记')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })

  it('renders grouped directory entries below the dropzone without expanding nested files', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))

    expect(screen.getByRole('tab', { name: '目录' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('点击选择目录或拖拽到此处')).toBeInTheDocument()
    expect(screen.getByText('递归导入目录中的 PDF, DOCX, MD, XLSX, TXT, CSV')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-source-directory-list')).not.toBeInTheDocument()

    setMockAcceptedFiles([
      createMockFile('guide.pdf', 1024, 'docs/guide.pdf'),
      createMockFile('api.md', 2048, 'docs/api.md'),
      createMockFile('report.csv', 1024, 'reports/report.csv'),
      createMockFile('ignored.txt', 1024)
    ])

    fireEvent.click(screen.getByTestId('mock-directory-dropzone-trigger'))

    const directoryList = screen.getByTestId('knowledge-source-directory-list')

    expect(directoryList).toHaveClass('max-h-52')
    expect(directoryList).toHaveClass('overflow-y-auto')
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('reports')).toBeInTheDocument()
    expect(screen.getByText('已选 2 个目录')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeEnabled()
    expect(screen.getByText('2 文档 · 3 KB')).toBeInTheDocument()
    expect(screen.getByText('1 文档 · 1 KB')).toBeInTheDocument()
    expect(screen.queryByText('guide.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('api.md')).not.toBeInTheDocument()
    expect(screen.queryByText('report.csv')).not.toBeInTheDocument()
  })

  it('removes a directory entry when delete is clicked', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))

    setMockAcceptedFiles([
      createMockFile('guide.pdf', 1024, 'docs/guide.pdf'),
      createMockFile('report.csv', 1024, 'reports/report.csv')
    ])

    fireEvent.click(screen.getByTestId('mock-directory-dropzone-trigger'))

    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByText('reports')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0])

    expect(screen.queryByText('docs')).not.toBeInTheDocument()
    expect(screen.getByText('reports')).toBeInTheDocument()
    expect(screen.getByText('已选 1 个目录')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '删除' })).toHaveLength(1)
  })

  it('renders the url form copy and placeholder when the url tab becomes active', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '网址' }))

    expect(screen.getByRole('tab', { name: '网址' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('输入网页链接：')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://example.com/article')).toBeInTheDocument()
    expect(screen.getByText('将自动抓取页面文本并分块索引')).toBeInTheDocument()
  })

  it('renders the website crawler settings with default values when the website tab becomes active', () => {
    render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('tab', { name: '网站' }))

    expect(screen.getByRole('tab', { name: '网站' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('输入站点地址或 Sitemap：')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('https://docs.cherry-ai.com/')).toBeInTheDocument()
    expect(screen.getByText('Sitemap 示例：https://docs.cherry-ai.com/sitemap-pages.xml')).toBeInTheDocument()
    expect(screen.getByText('爬虫设置')).toBeInTheDocument()
    expect(screen.getByLabelText('爬取深度')).toHaveValue('2')
    expect(screen.getByLabelText('最大页面数')).toHaveValue('50')
    expect(screen.getByText('深度 1 = 仅首页，2 = 首页链接的页面')).toBeInTheDocument()
  })

  it('triggers close through both the footer cancel button and the header close button', () => {
    const onOpenChange = vi.fn()

    render(<AddKnowledgeSourceDialog open onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(onOpenChange).toHaveBeenNthCalledWith(1, false)
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false)
  })

  it('resets the active source and local selections after the dialog closes and reopens', () => {
    const { rerender } = render(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    setMockAcceptedFiles([createMockFile('alpha.pdf', 1024)])
    fireEvent.click(screen.getByTestId('mock-file-dropzone-trigger'))
    expect(screen.getByTestId('knowledge-source-file-list')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))
    setMockAcceptedFiles([createMockFile('guide.pdf', 1024, 'docs/guide.pdf')])
    fireEvent.click(screen.getByTestId('mock-directory-dropzone-trigger'))

    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '目录' })).toHaveAttribute('aria-selected', 'true')

    rerender(<AddKnowledgeSourceDialog open={false} onOpenChange={vi.fn()} />)
    rerender(<AddKnowledgeSourceDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '目录' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('点击选择文件或拖拽到此处')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-source-file-list')).not.toBeInTheDocument()
    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '目录' }))

    expect(screen.queryByTestId('knowledge-source-directory-list')).not.toBeInTheDocument()
    expect(screen.queryByText('docs')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '笔记' }))

    expect(screen.getByText('暂未接入笔记数据源')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled()
  })
})
