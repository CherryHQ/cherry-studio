import { KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED } from '@shared/data/types/knowledge'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DataSourcePanel from '../DataSourcePanel'
import { createDirectoryItem, createFileItem, createNoteItem, createUrlItem } from './testUtils'

const mockUseQuery = vi.fn()

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args)
}))

// The real DynamicVirtualList renders nothing under jsdom (no layout to measure),
// so stub it with a plain pass-through that renders every row.
vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({ list, children }: { list: T[]; children: (item: T) => ReactNode }) => (
    <div data-testid="virtual-list">
      {list.map((item, index) => (
        <div key={index}>{children(item)}</div>
      ))}
    </div>
  )
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const React = await import('react')
  const actual = (await importOriginal()) as Record<string, unknown>
  const PopoverContext = React.createContext<{ open: boolean; onOpenChange?: (open: boolean) => void }>({
    open: false
  })

  return {
    ...actual,
    Button: ({
      children,
      type = 'button',
      ...props
    }: {
      children: ReactNode
      type?: 'button' | 'submit' | 'reset'
      [key: string]: unknown
    }) => (
      <button type={type} {...props}>
        {children}
      </button>
    ),
    Checkbox: ({
      checked,
      onCheckedChange,
      'aria-label': ariaLabel
    }: {
      checked?: boolean | 'indeterminate'
      onCheckedChange?: (checked: boolean | 'indeterminate') => void
      'aria-label'?: string
    }) => (
      <input
        type="checkbox"
        aria-label={ariaLabel}
        aria-checked={checked === 'indeterminate' ? 'mixed' : Boolean(checked)}
        checked={checked === true}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
      />
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
          <button
            type="button"
            onClick={() => {
              void Promise.resolve(onConfirm?.()).then(() => onOpenChange?.(false))
            }}>
            {confirmText}
          </button>
        </div>
      ) : null,
    Popover: ({
      children,
      open,
      onOpenChange
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => <PopoverContext value={{ open: Boolean(open), onOpenChange }}>{children}</PopoverContext>,
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const { open } = React.use(PopoverContext)
      return open ? <>{children}</> : null
    },
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const { onOpenChange } = React.use(PopoverContext)

      return (
        <span role="presentation" onClickCapture={() => onOpenChange?.(true)} onMouseEnter={() => onOpenChange?.(true)}>
          {children}
        </span>
      )
    },
    Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
})

vi.mock('@renderer/utils/time', () => ({
  formatRelativeTime: () => '刚刚'
}))

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: (error: unknown, prefix: string) =>
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`
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
      if (key === 'knowledge.data_source.bulk.selected_count') {
        return `已选 ${options?.count} 项`
      }

      if (key === 'knowledge.data_source.bulk.loaded_only_hint') {
        return `仅已加载，共 ${options?.total} 项`
      }

      if (key === 'knowledge.data_source.bulk.delete_confirm_description') {
        return `确认删除选中的 ${options?.count} 个数据源`
      }

      if (key === 'knowledge.meta.updated_at') {
        return `更新于 ${options?.time ?? ''}`
      }

      return (
        (
          {
            'knowledge.data_source.add_dialog.title': '添加数据源',
            'knowledge.data_source.toolbar.add': '添加数据源',
            'knowledge.data_source.empty.title': '上传第一个数据源',
            'knowledge.data_source.empty.shortcuts.file.title': '文件',
            'knowledge.data_source.empty.shortcuts.url.title': '链接',
            'knowledge.data_source.empty.shortcuts.directory.title': '目录导入',
            'knowledge.data_source.bulk.delete': '删除',
            'knowledge.data_source.bulk.reindex': '重新索引',
            'knowledge.data_source.bulk.delete_confirm_title': '确认批量删除',
            'knowledge.data_source.table.columns.name': '名称',
            'knowledge.data_source.table.columns.type': '类型',
            'knowledge.data_source.table.columns.status': '状态',
            'knowledge.data_source.table.columns.updated_at': '更新时间',
            'knowledge.data_source.table.columns.actions': '操作',
            'knowledge.data_source.table.select_all': '全选',
            'knowledge.data_source.table.select_row': '选择行',
            'knowledge.data_source.table.aria_label': '数据源列表',
            'knowledge.data_source.list.loading_more': '加载更多…',
            'knowledge.data_source.list.end_reached': '没有更多了',
            'common.add': '添加数据源',
            'common.clear': '清除',
            'common.loading': '加载中...',
            'common.cancel': '取消',
            'common.delete': '删除',
            'common.more': '更多',
            'common.no_results': '暂无结果',
            'knowledge.data_source.actions.preview_source': '预览原文',
            'knowledge.data_source.actions.view_chunks': '查看 Chunks',
            'knowledge.data_source.actions.reindex': '重新索引',
            'knowledge.data_source.actions.delete': '删除',
            'knowledge.data_source.delete_confirm_description': '删除后将无法恢复该数据源及其索引数据。',
            'knowledge.data_source.delete_confirm_title': '确认删除数据源',
            'knowledge.data_source.delete_failed': '删除数据源失败',
            'knowledge.data_source.reindex_failed': '重新索引数据源失败',
            'knowledge.data_source.empty_description': '暂无数据源',
            'knowledge.data_source.filters.file': '文件',
            'knowledge.data_source.filters.note': '笔记',
            'knowledge.data_source.filters.directory': '目录',
            'knowledge.data_source.filters.url': '链接',
            'knowledge.data_source.add_dialog.sources.directory': '目录',
            'knowledge.data_source.add_dialog.sources.file': '文件',
            'knowledge.data_source.add_dialog.sources.note': '笔记',
            'knowledge.data_source.add_dialog.sources.url': '链接',
            'knowledge.data_source.status.ready': '就绪',
            'knowledge.data_source.status.error': '失败',
            'knowledge.data_source.status.embedding': '向量化中',
            'knowledge.data_source.status.chunking': '分块中',
            'knowledge.data_source.status.pending': '等待中',
            'knowledge.error.directory_not_migrated': '该文件夹内容迁移失败，请删除后重新上传。',
            'knowledge.file_hint': `支持 ${options?.file_types} 格式`,
            'knowledge.status.processing': '处理中',
            'knowledge.rag.file_processing': '文件处理'
          } as Record<string, string>
        )[key] ?? key
      )
    }
  })
}))

describe('DataSourcePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined
    })
    Object.assign(window, {
      toast: {
        error: vi.fn()
      }
    })
  })

  it('renders loading and empty states through the list composition without changing panel behavior', () => {
    const { rerender } = render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[]}
        isLoading
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('加载中...')).toBeInTheDocument()

    rerender(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('上传第一个数据源')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '链接' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '网站' })).not.toBeInTheDocument()
  })

  it('guides users from the empty data source state into file or URL add flows', () => {
    const onAdd = vi.fn()

    const { rerender } = render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[]}
        isLoading={false}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('暂无数据源')).toBeInTheDocument()
    expect(screen.getByText('上传第一个数据源')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '笔记' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '链接' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '网站' })).not.toBeInTheDocument()

    expect(document.querySelector('input[type="file"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '文件' }))

    expect(onAdd).toHaveBeenCalledWith('file')

    rerender(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[]}
        isLoading={false}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '链接' }))

    expect(onAdd).toHaveBeenCalledWith('url')
  })

  it('uses the first non-empty note line as the title and leaves blank notes without the old fallback label', () => {
    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
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
    expect(screen.getAllByText('笔记')).toHaveLength(2)
  })

  it('renders url and directory items from their required source fields', () => {
    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' }),
          createDirectoryItem({ id: 'directory-1', source: '/Users/eeee/本地资料夹' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('https://example.com/product-docs')).toBeInTheDocument()
    const directoryTitle = screen.getByText('本地资料夹')
    expect(directoryTitle).toBeInTheDocument()
    expect(directoryTitle).toHaveAttribute('title', '/Users/eeee/本地资料夹')
    expect(screen.getByText('更新于 刚刚')).toBeInTheDocument()
  })

  it('renders processing directory rows as processing when no phase is available', () => {
    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createDirectoryItem({ id: 'directory-1', source: '/Users/eeee/本地资料夹', status: 'processing' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    const directoryTitle = screen.getByText('本地资料夹')
    expect(directoryTitle).toBeInTheDocument()
    expect(directoryTitle).toHaveAttribute('title', '/Users/eeee/本地资料夹')
    expect(screen.getByText('处理中')).toBeInTheDocument()
    expect(screen.queryByText('等待中')).not.toBeInTheDocument()
  })

  it('renders a migrated v1 directory as a red failure with a migration-failed tooltip', () => {
    // The v2 migration drops a v1 folder's container-level vectors and marks the
    // item `failed` with this code; the row must render it with the localized
    // migration-failed tooltip so the user knows to delete and re-upload.
    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createDirectoryItem({
            id: 'directory-1',
            source: '/Users/eeee/本地资料夹',
            status: 'failed',
            error: KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
          })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByLabelText('该文件夹内容迁移失败，请删除后重新上传。')).toBeInTheDocument()
  })

  it('does not open the add source dialog from the header button before a source is selected', () => {
    const onAdd = vi.fn()

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '添加数据源' }))

    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByText('季度报告.pdf')).toBeInTheDocument()
  })

  it('opens the add dialog when selecting the file source from the header menu', () => {
    const onAdd = vi.fn()

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    expect(document.querySelector('input[type="file"]')).toBeNull()

    fireEvent.mouseEnter(screen.getByRole('button', { name: '添加数据源' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '文件' }))

    expect(onAdd).toHaveBeenCalledWith('file')
  })

  it('shows source choices on header add hover and forwards the selected source', () => {
    const onAdd = vi.fn()

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: '添加数据源' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '目录' }))

    expect(onAdd).toHaveBeenCalledWith('directory')
  })

  it('prunes selected item ids when items are removed', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)

    const { rerender } = render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={onDelete}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()

    rerender(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={onDelete}
        onReindex={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    })
    expect(screen.queryByText('会议记录.pdf')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    expect(onDelete).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'file-2' }))
  })

  it('forwards row clicks to the item chunk detail handler', () => {
    const onItemClick = vi.fn()
    const item = createFileItem({ id: 'file-1', originName: '季度报告.pdf' })

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
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
        updatedAt="2026-04-15T09:00:00+08:00"
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
        updatedAt="2026-04-15T09:00:00+08:00"
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

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    })
  })

  it('shows delete failure toast and closes the confirmation dialog when delete rejects', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('delete failed'))

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={onDelete}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('删除数据源失败: delete failed')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('forwards row reindex actions', async () => {
    const onReindex = vi.fn()

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createFileItem({ id: 'file-1', originName: '季度报告.pdf' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={onReindex}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    await waitFor(() => {
      expect(onReindex).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    })
  })

  it('shows bulk reindex failure toast and keeps the current selection when reindex rejects', async () => {
    const onReindex = vi.fn().mockRejectedValue(new Error('reindex failed'))

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={onReindex}
      />
    )

    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择行' })[0])
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('重新索引数据源失败: reindex failed')
    })
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  })

  it('clears the current selection after bulk reindex succeeds', async () => {
    const onReindex = vi.fn().mockResolvedValue(undefined)

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={onReindex}
      />
    )

    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择行' })[0])
    fireEvent.click(screen.getByRole('button', { name: '重新索引' }))

    await waitFor(() => {
      expect(onReindex).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    })
    await waitFor(() => {
      expect(screen.queryByText('已选 1 项')).not.toBeInTheDocument()
    })
  })

  it('confirms bulk delete for selected rows and clears selection after deleting each item', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={onDelete}
        onReindex={vi.fn()}
      />
    )

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: '选择行' })
    fireEvent.click(rowCheckboxes[0])
    fireEvent.click(rowCheckboxes[1])
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('确认批量删除')
    expect(screen.getByRole('dialog')).toHaveTextContent('确认删除选中的 2 个数据源')

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(2)
    })
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-2' }))
    await waitFor(() => {
      expect(screen.queryByText('已选 2 项')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows bulk delete failure toast and keeps selection when one selected delete rejects', async () => {
    const onDelete = vi.fn().mockImplementation((item) => {
      if (item.id === 'file-2') {
        return Promise.reject(new Error('delete failed'))
      }

      return Promise.resolve()
    })

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={onDelete}
        onReindex={vi.fn()}
      />
    )

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: '选择行' })
    fireEvent.click(rowCheckboxes[0])
    fireEvent.click(rowCheckboxes[1])
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('删除数据源失败: delete failed')
    })
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('selects all rows from the header checkbox and clears selection when toggled again from all selected', async () => {
    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    const selectAllCheckbox = screen.getByRole('checkbox', { name: '全选' })

    fireEvent.click(selectAllCheckbox)

    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    const selectedRowCheckboxes = screen.getAllByRole('checkbox', { name: '选择行' })
    expect(selectedRowCheckboxes).toHaveLength(2)
    expect(selectedRowCheckboxes[0]).toBeChecked()
    expect(selectedRowCheckboxes[1]).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))

    await waitFor(() => {
      expect(screen.queryByText('已选 2 项')).not.toBeInTheDocument()
    })
  })

  it('warns that select-all only covers loaded rows when more pages remain on the server', () => {
    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        total={10}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))

    // Selection is accurate (2 loaded), but the bulk bar makes clear it won't touch the
    // other 8 rows that haven't been paged in yet.
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()
    expect(screen.getByText('仅已加载，共 10 项')).toBeInTheDocument()
  })

  it('shows the header select-all checkbox as partially selected after deselecting one selected row', () => {
    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择行' })[0])

    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '全选' })).toHaveAttribute('aria-checked', 'mixed')
  })

  it('prunes selected item ids when the backing item list changes', async () => {
    const { rerender } = render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[
          createFileItem({ id: 'file-1', originName: '季度报告.pdf' }),
          createFileItem({ id: 'file-2', originName: '会议记录.pdf' })
        ]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    fireEvent.click(screen.getAllByRole('checkbox', { name: '选择行' })[0])
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()

    rerender(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
        items={[createFileItem({ id: 'file-2', originName: '会议记录.pdf' })]}
        isLoading={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onReindex={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('已选 1 项')).not.toBeInTheDocument()
    })
  })

  it('does not forward menu actions as row clicks', async () => {
    const onItemClick = vi.fn()
    const onReindex = vi.fn()

    render(
      <DataSourcePanel
        updatedAt="2026-04-15T09:00:00+08:00"
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

    await waitFor(() => {
      expect(onReindex).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    })
    expect(onItemClick).not.toHaveBeenCalled()
  })
})
