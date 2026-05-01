import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DataSourcePanel from '../DataSourcePanel'
import { createDirectoryItem, createFileItem, createNoteItem, createSitemapItem, createUrlItem } from './testUtils'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return {
    ...actual,
    Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <button {...props}>{children}</button>
    ),
    ConfirmDialog: ({
      open,
      title,
      description,
      confirmText,
      cancelText,
      onConfirm,
      onOpenChange
    }: {
      open?: boolean
      title: ReactNode
      description?: ReactNode
      confirmText?: string
      cancelText?: string
      onConfirm?: () => void | Promise<void>
      onOpenChange?: (open: boolean) => void
    }) =>
      open ? (
        <div role="dialog">
          <div>{title}</div>
          <div>{description}</div>
          <button type="button" onClick={() => onOpenChange?.(false)}>
            {cancelText}
          </button>
          <button type="button" onClick={() => void onConfirm?.()}>
            {confirmText}
          </button>
        </div>
      ) : null,
    Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
})

vi.mock('@renderer/pages/knowledge.v2/utils', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined
  },
  useTranslation: () => ({
    i18n: {
      language: 'zh-CN'
    },
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'knowledge_v2.data_source.ready_summary') {
        return `已就绪 ${options?.ready}/${options?.total}`
      }

      return (
        (
          {
            'knowledge_v2.data_source.add_dialog.title': '添加数据源',
            'common.add': '添加数据源',
            'common.loading': '加载中...',
            'common.cancel': '取消',
            'common.delete': '删除',
            'common.more': '更多',
            'common.no_results': '暂无结果',
            'knowledge_v2.data_source.actions.preview_source': '预览原文',
            'knowledge_v2.data_source.actions.view_chunks': '查看 Chunks',
            'knowledge_v2.data_source.actions.reindex': '重新索引',
            'knowledge_v2.data_source.actions.delete': '删除',
            'knowledge_v2.data_source.delete_confirm_description': '删除后将无法恢复该数据源及其索引数据。',
            'knowledge_v2.data_source.delete_confirm_title': '确认删除数据源',
            'knowledge_v2.data_source.filters.all': '全部',
            'knowledge_v2.data_source.filters.file': '文件',
            'knowledge_v2.data_source.filters.note': '笔记',
            'knowledge_v2.data_source.filters.directory': '目录',
            'knowledge_v2.data_source.filters.url': '网址',
            'knowledge_v2.data_source.filters.sitemap': '网站',
            'knowledge_v2.data_source.status.ready': '就绪',
            'knowledge_v2.data_source.status.error': '失败',
            'knowledge_v2.data_source.status.embedding': '向量化中',
            'knowledge_v2.data_source.status.chunking': '分块中',
            'knowledge_v2.data_source.status.pending': '等待中',
            'knowledge_v2.status_processing': '处理中',
            'knowledge_v2.rag.file_processing': '文件处理'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

describe('DataSourcePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading and empty states through the list composition without changing panel behavior', () => {
    const { rerender } = render(
      <DataSourcePanel items={[]} isLoading onAdd={vi.fn()} onDelete={vi.fn()} onReindex={vi.fn()} />
    )

    expect(screen.getByText('加载中...')).toBeInTheDocument()

    rerender(<DataSourcePanel items={[]} isLoading={false} onAdd={vi.fn()} onDelete={vi.fn()} onReindex={vi.fn()} />)

    expect(screen.getByText('暂无结果')).toBeInTheDocument()
  })

  it('uses the first non-empty note line as the title and leaves blank notes without the old fallback label', () => {
    render(
      <DataSourcePanel
        items={[
          createNoteItem({ id: 'note-1', content: '\n \n  第一行标题  \n第二行内容' }),
          createNoteItem({ id: 'note-2', content: '\n   \n' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('第一行标题')).toBeInTheDocument()
    expect(screen.getAllByText('笔记')).toHaveLength(1)
    expect(screen.getByText('已就绪 2/2')).toBeInTheDocument()
  })

  it('renders url, sitemap, and directory items from their required source fields and keeps the ready count correct', () => {
    render(
      <DataSourcePanel
        items={[
          createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' }),
          createSitemapItem({
            id: 'sitemap-1',
            source: 'https://example.com/sitemap.xml',
            status: 'processing',
            phase: 'preparing'
          }),
          createDirectoryItem({ id: 'directory-1', source: '/Users/eeee/本地资料夹' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('https://example.com/product-docs')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/sitemap.xml')).toBeInTheDocument()
    expect(screen.getByText('/Users/eeee/本地资料夹')).toBeInTheDocument()
    expect(screen.getByText('已就绪 2/3')).toBeInTheDocument()
    expect(screen.getByText('等待中')).toBeInTheDocument()
  })

  it('renders processing directory and sitemap rows as processing when no phase is available', () => {
    render(
      <DataSourcePanel
        items={[
          createDirectoryItem({ id: 'directory-1', source: '/Users/eeee/本地资料夹', status: 'processing' }),
          createSitemapItem({
            id: 'sitemap-1',
            source: 'https://example.com/sitemap.xml',
            status: 'processing'
          })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('/Users/eeee/本地资料夹')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/sitemap.xml')).toBeInTheDocument()
    expect(screen.getAllByText('处理中')).toHaveLength(2)
    expect(screen.queryByText('等待中')).not.toBeInTheDocument()
  })

  it('builds filter labels from the type display config and filters the visible rows by type', () => {
    render(
      <DataSourcePanel
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createNoteItem({ id: 'note-1', content: '会议纪要' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '网址' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '网站' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(screen.getByText('季度报告.pdf')).toBeInTheDocument()
    expect(screen.queryByText('会议纪要')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '笔记' }))
    expect(screen.getByText('会议纪要')).toBeInTheDocument()
    expect(screen.queryByText('季度报告.pdf')).not.toBeInTheDocument()
  })

  it('forwards the header add action without affecting the existing list behavior', () => {
    const onAdd = vi.fn()

    render(
      <DataSourcePanel
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '添加数据源' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByText('季度报告.pdf')).toBeInTheDocument()
  })

  it('forwards row clicks to the item chunk detail handler', () => {
    const onItemClick = vi.fn()
    const item = createFileItem({ id: 'file-1', originName: '季度报告.pdf' })

    render(
      <DataSourcePanel
        items={[item]}
        isLoading={false}
        onAdd={vi.fn()}
        onItemClick={onItemClick}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('季度报告.pdf'))

    expect(onItemClick).toHaveBeenCalledWith('file-1')
  })

  it('forwards view chunks menu actions to the item chunk detail handler', () => {
    const onItemClick = vi.fn()
    const item = createFileItem({ id: 'file-1', originName: '季度报告.pdf' })

    render(
      <DataSourcePanel
        items={[item]}
        isLoading={false}
        onAdd={vi.fn()}
        onItemClick={onItemClick}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '查看 Chunks' }))

    expect(onItemClick).toHaveBeenCalledWith('file-1')
  })

  it('opens delete confirmation before forwarding row delete actions', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)

    render(
      <DataSourcePanel
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={onDelete}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('确认删除数据源')
    expect(screen.getByRole('dialog')).toHaveTextContent('删除后将无法恢复该数据源及其索引数据。')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    })
  })

  it('forwards row reindex actions', () => {
    const onReindex = vi.fn()

    render(
      <DataSourcePanel
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={onReindex}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    expect(onReindex).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
  })

  it('does not forward menu actions as row clicks', () => {
    const onItemClick = vi.fn()
    const onReindex = vi.fn()

    render(
      <DataSourcePanel
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onItemClick={onItemClick}
        onDelete={vi.fn()}
        onReindex={onReindex}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    expect(onReindex).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    expect(onItemClick).not.toHaveBeenCalled()
  })
})
